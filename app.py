"""
CyberGuard Backend API
Hinglish Cyberbullying Detection using SVM (baseline) + MuRIL (advanced) + LLM fallback
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import requests
import re
from dotenv import load_dotenv

# Robust imports for ML libraries
try:
    import joblib
    import numpy as np
except ImportError:
    joblib = None
    np = None
    print("[WARN] joblib/numpy not found. ML models will be disabled.")

load_dotenv()

app = Flask(__name__)
CORS(app)

# OpenRouter API configuration
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

# Detection statistics with timestamps
from datetime import datetime, timedelta

stats = {
    "total_analyzed": 0,
    "flagged": 0,
    "flagged_items": []  # List of {"timestamp": ..., "text": ...}
}

# ─── Model Loading ────────────────────────────────────────────────

# SVM model
svm_model = None
tfidf_vectorizer = None

# MuRIL model
muril_model = None
muril_tokenizer = None

def load_svm():
    global svm_model, tfidf_vectorizer
    if joblib is None:
        print("[--] joblib not installed, skipping SVM load")
        return
        
    svm_path = "models/svm_model.joblib"
    tfidf_path = "models/tfidf_vectorizer.joblib"
    if os.path.exists(svm_path) and os.path.exists(tfidf_path):
        try:
            svm_model = joblib.load(svm_path)
            tfidf_vectorizer = joblib.load(tfidf_path)
            print("[OK] SVM model loaded")
        except Exception as e:
             print(f"[!!] SVM model failed to load: {e}")
    else:
        print("[--] SVM model not found - run svmtraining.py first")

def load_muril():
    global muril_model, muril_tokenizer
    model_path = "models/muril_model.h5"
    tokenizer_path = "models/muril_tokenizer"
    if os.path.exists(model_path) and os.path.exists(tokenizer_path):
        try:
            import tensorflow as tf
            from transformers import AutoTokenizer, TFAutoModel
            # Need to load the base model for custom_objects
            muril_base = TFAutoModel.from_pretrained("google/muril-base-cased")
            muril_model = tf.keras.models.load_model(
                model_path,
                custom_objects={"TFBertModel": type(muril_base)}
            )
            muril_tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)
            print("[OK] MuRIL model loaded")
        except Exception as e:
            print(f"[!!] MuRIL model failed to load or libraries missing: {e}")
    else:
        print("[--] MuRIL model not found - run muriltraining.py first")


# ─── Hinglish Detection ──────────────────────────────────────────

STRONG_HINDI_MARKERS = {
    'hai', 'hain', 'hota', 'hoti', 'tha', 'thi', 'hun', 'hu',
    'mein', 'kya', 'kyu', 'kyun', 'kaise', 'kahan', 'kaun', 'kab',
    'nahi', 'nahin', 'nhi', 'mat',
    'yeh', 'woh', 'wahi', 'yahi', 'ye', 'wo',
    'tum', 'aap', 'hum', 'mera', 'meri', 'tera', 'teri', 'uska', 'uski', 'iska', 'iski',
    'bhi', 'aur', 'lekin', 'phir', 'toh', 'magar', 'par',
    'bohot', 'bahut', 'zyada', 'bilkul', 'ekdum', 'sabse', 'kaafi',
    'accha', 'achha', 'bura', 'sahi', 'galat', 'theek', 'kharab', 'bekaar',
    'dekh', 'dekho', 'bata', 'batao', 'bolo', 'suno', 'sun', 'bol',
    'karo', 'karna', 'karke', 'karenge', 'karega', 'karunga', 'karungi',
    'jao', 'jaao', 'aao', 'aaja', 'chal', 'nikal',
    'yaar', 'bhai', 'banda', 'bandi', 'dost', 'bro',
    'wala', 'wali', 'wale', 'waala', 'waali', 'waale',
    'abhi', 'pehle', 'baad', 'jaldi', 'dheere',
    'paisa', 'kaam', 'ghar', 'duniya', 'log',
    'dikhta', 'dikhti', 'lagta', 'lagti',
    'kuch', 'kitna', 'kitni', 'koi', 'kisi',
    'isko', 'usko', 'inhe', 'unhe', 'isme', 'usme', 'ispe', 'uspe',
    'mujhe', 'tujhe', 'humein',
    'apna', 'apni', 'apne',
    'kahi', 'kahin', 'kabhi'
}

TOXIC_HINDI = {
    'chutiya', 'kamina', 'kamini', 'harami', 'haramkhor',
    'saala', 'saali', 'bakwas', 'faltu', 'gadha',
    'bewakoof', 'bewkoof', 'pagal', 'paagal', 'ghatiya',
    'nalayak', 'nikamma', 'wahiyat', 'kachra', 'tatti',
    'randi', 'madarchod', 'behenchod', 'bhosdike', 'lodu',
    'kutti', 'kutta', 'dhakkan', 'phattu', 'tharki',
    'chapri', 'chhapri', 'nalla', 'aukat', 'maarunga',
    'besharam', 'badtameez', 'jahil', 'lafanga',
    'chamaar', 'bhangi', 'hijra', 'chakka',
    'bhosdi', 'gand', 'gaand', 'lawda', 'lauda', 'choot',
    'rand', 'chinaal', 'kutiya'
}

def is_hinglish(text: str) -> bool:
    """Check if text contains Hinglish (Hindi words in Roman script)."""
    words = [re.sub(r'[^a-z]', '', w) for w in text.lower().split()]
    
    # Count Hindi markers
    hindi_count = sum(1 for w in words if len(w) >= 2 and w in STRONG_HINDI_MARKERS)
    
    # Check for toxic words directly
    has_toxic = any(w in TOXIC_HINDI for w in words)
    
    # Logic: 
    # 1. If it has a known toxic Hindi word, it's definitely the target (Cyberbullying in Hinglish).
    # 2. If it has at least 2 strong Hindi markers, it's likely Hinglish.
    # 3. If it has 1 marker but the text is short (< 5 words), be more lenient if it looks like a phrase.
    
    if has_toxic:
        return True
    
    if len(words) < 5 and hindi_count >= 1:
        return True
        
    return hindi_count >= 2

def clean_text(text: str) -> str:
    """Clean text for model input."""
    text = text.lower()
    text = re.sub(r'http\S+|www\.\S+', '', text)
    text = re.sub(r'@\w+|#\w+', '', text)
    text = re.sub(r'[^a-z0-9\s!?.,-]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# ─── Detection Methods ───────────────────────────────────────────

def detect_with_svm(text: str) -> dict:
    """Detect using SVM + TF-IDF (baseline model)."""
    if svm_model is None or tfidf_vectorizer is None:
        return {"error": "SVM model not loaded"}

    cleaned = clean_text(text)
    features = tfidf_vectorizer.transform([cleaned])
    prediction = svm_model.predict(features)[0]
    probability = svm_model.predict_proba(features)[0]
    confidence = float(max(probability))

    return {
        "is_cyberbullying": bool(prediction == 1),
        "confidence": round(confidence, 3),
        "category": "insult" if prediction == 1 else "none",
        "explanation": "Detected by SVM baseline model" if prediction == 1 else "",
    }


def detect_with_muril(text: str) -> dict:
    """Detect using fine-tuned MuRIL transformer (advanced model)."""
    if muril_model is None or muril_tokenizer is None:
        return {"error": "MuRIL model not loaded"}

    import tensorflow as tf

    inputs = muril_tokenizer(
        text, truncation=True, padding="max_length",
        max_length=128, return_tensors="tf"
    )
    prediction = muril_model.predict(
        [inputs["input_ids"], inputs["attention_mask"]], verbose=0
    )
    score = float(prediction[0][0])

    return {
        "is_cyberbullying": score > 0.5,
        "confidence": round(score if score > 0.5 else 1 - score, 3),
        "category": "insult" if score > 0.5 else "none",
        "explanation": "Detected by MuRIL transformer model" if score > 0.5 else "",
    }


def detect_with_openrouter(text: str) -> dict:
    """Use OpenRouter LLM as fallback detector."""
    if not OPENROUTER_API_KEY:
        return {"error": "OpenRouter API key not configured"}

    prompt = f"""You detect cyberbullying/toxicity in mixed Hindi-English (Hinglish) social media comments.

    STRICT RULES:
    1. Analyze the intent and sentiment.
    2. Flag SLANG, ABUSIVE WORDS, THREATS, and HARASSMENT.
    3. Ignore friendly banter or positive comments.
    4. Ignore PURE English comments (unless they contain specific Indian context abuse).
    5. Output JSON only.

    Examples:
    - "tu pagal hai kya" -> TRUE (Insult)
    - "kya mast video hai" -> FALSE (Appreciation)
    - "you are stupid" -> FALSE (Pure English, out of scope for Hinglish detector usually, but if toxic, flag it)
    - "chal nikal yahan se" -> TRUE (Harassment)

    Text: "{text}"

    Respond ONLY with JSON:
    {{
        "is_cyberbullying": true/false,
        "confidence": 0.0-1.0,
        "category": "none" | "insult" | "threat" | "hate_speech" | "harassment",
        "explanation": "brief reason"
    }}"""

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "CyberGuard"
    }
    payload = {
        "model": "google/gemini-2.0-flash-001",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 200
    }

    try:
        response = requests.post(OPENROUTER_BASE_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        return json.loads(content)
    except Exception as e:
        print(f"OpenRouter error: {e}")
        return {"error": str(e)}


def detect_with_keywords(text: str) -> dict:
    """Keyword-based fallback detection."""
    t = text.lower()

    keywords = [
        ("chutiya", "insult", "Contains abusive Hindi slur"),
        ("madarchod", "insult", "Contains severe abusive language"),
        ("behenchod", "insult", "Contains severe abusive language"),
        ("bhosdike", "insult", "Contains severe abusive slur"),
        ("randi", "insult", "Contains gendered abusive slur"),
        ("harami", "insult", "Contains abusive Hindi slur"),
        ("haramkhor", "insult", "Contains abusive Hindi slur"),
        ("kutta", "insult", "Dehumanizing insult"),
        ("kutti", "insult", "Dehumanizing gendered insult"),
        ("kamina", "insult", "Contains abusive Hindi slur"),
        ("saala", "insult", "Contains abusive Hindi term"),
        ("saali", "insult", "Contains gendered abusive term"),
        ("lodu", "insult", "Contains vulgar abusive term"),
        ("maar dunga", "threat", "Contains violent threat"),
        ("maarunga", "threat", "Contains violent threat"),
        ("aukat", "harassment", "Demeaning social status attack"),
        ("gadha", "insult", "Called someone a donkey"),
        ("bewakoof", "insult", "Called someone foolish"),
        ("pagal", "insult", "Called someone crazy"),
        ("chapri", "discrimination", "Classist slur"),
        ("ghatiya", "insult", "Called something inferior"),
        ("nalayak", "insult", "Called someone worthless"),
        ("nikamma", "insult", "Called someone useless"),
        ("tharki", "harassment", "Called someone a pervert"),
        ("chamaar", "discrimination", "Caste-based slur"),
        ("bhangi", "discrimination", "Caste-based slur"),
        ("bakwas", "insult", "Called something nonsense"),
        ("faltu", "insult", "Called something worthless"),
        ("bekar", "insult", "Called something useless"),
        ("wahiyat", "insult", "Called something terrible"),
        ("tatti", "insult", "Vulgar dismissal"),
        ("ullu", "insult", "Called someone a fool"),
        ("besharam", "insult", "Called someone shameless"),
        ("badtameez", "insult", "Called someone ill-mannered"),
        ("gand", "insult", "Vulgar language"),
        ("lawda", "insult", "Vulgar language"),
        ("choot", "insult", "Vulgar language"),
    ]

    for word, category, explanation in keywords:
        if word in t:
            return {
                "is_cyberbullying": True,
                "confidence": 0.75,
                "category": category,
                "explanation": explanation
            }

    return {
        "is_cyberbullying": False,
        "confidence": 0.1,
        "category": "none",
        "explanation": ""
    }


def get_flagged_this_week():
    """Count flagged items from the past 7 days."""
    now = datetime.now()
    week_ago = now - timedelta(days=7)
    return sum(1 for item in stats["flagged_items"] 
               if datetime.fromisoformat(item["timestamp"]) >= week_ago)


# ─── API Routes ───────────────────────────────────────────────────

@app.route("/api/detect", methods=["POST"])
def detect():
    """
    Main detection endpoint.
    Priority: 
    1. Check if Hinglish.
    2. Try MuRIL/SVM.
    3. If confidence is low/medium (hybrid mode), ask LLM.
    4. Fallback to keywords.
    """
    data = request.get_json()

    if not data or "text" not in data:
        return jsonify({"error": "No text provided"}), 400

    text = data["text"].strip()
    if len(text) < 3:
        return jsonify({"error": "Text too short"}), 400

    # 1. Hinglish Check
    if not is_hinglish(text):
        # Optional: could use LLM here if we suspect it might be English bullying
        # But per requirements, we focus on Hinglish.
        stats["total_analyzed"] += 1
        return jsonify({
            "is_cyberbullying": False,
            "confidence": 0.0,
            "category": "none",
            "explanation": "Not identified as Hinglish",
            "method": "hinglish_check"
        })

    result = None
    method = None
    
    # 2. Local Models (MuRIL / SVM)
    local_result = None
    
    if muril_model is not None:
        local_result = detect_with_muril(text)
        method = "muril"
    elif svm_model is not None:
        local_result = detect_with_svm(text)
        method = "svm"
        
    # 3. Hybrid Logic: Decide whether to trust local model or ask LLM
    use_llm = data.get("use_llm", True) and OPENROUTER_API_KEY
    
    if local_result and "error" not in local_result:
        # High confidence? Trust it.
        if local_result["confidence"] > 0.85:
            result = local_result
        else:
            # Low/Medium confidence -> specific check with LLM if enabled
            if use_llm:
                print(f"Low confidence ({local_result['confidence']}) for '{text}'. Consulting LLM...")
                llm_result = detect_with_openrouter(text)
                if "error" not in llm_result:
                    result = llm_result
                    method = "hybrid_llm"
                else:
                    result = local_result # Fallback to local if LLM fails
            else:
                result = local_result
    else:
        # No local model or error -> try LLM directly
        if use_llm:
            result = detect_with_openrouter(text)
            method = "llm_direct"
            
    # 4. Keyword Fallback (if everything else failed)
    if result is None or "error" in result:
        result = detect_with_keywords(text)
        method = "keyword"

    result["method"] = method

    # Update stats
    stats["total_analyzed"] += 1
    if result.get("is_cyberbullying"):
        stats["flagged"] += 1
        stats["flagged_items"].append({
            "timestamp": datetime.now().isoformat(),
            "text": text[:100]
        })

    return jsonify(result)


@app.route("/api/detect/batch", methods=["POST"])
def detect_batch():
    """Batch detection for multiple texts."""
    data = request.get_json()
    if not data or "texts" not in data:
        return jsonify({"error": "No texts provided"}), 400

    results = []
    # Limit batch size to prevent timeout
    for text in data["texts"][:20]:
        # Reuse logic? For batch, maybe stick to fast models to avoid rate limits
        if len(text.strip()) >= 3 and is_hinglish(text):
            res = detect_with_keywords(text) # Default fast fallback
            
            if muril_model:
                res = detect_with_muril(text)
                res["method"] = "muril"
            elif svm_model:
                res = detect_with_svm(text)
                res["method"] = "svm"
                
            res["text"] = text[:100]
            results.append(res)
            stats["total_analyzed"] += 1
            if res.get("is_cyberbullying"):
                stats["flagged"] += 1
                stats["flagged_items"].append({
                    "timestamp": datetime.now().isoformat(),
                    "text": text[:100]
                })

    return jsonify({"results": results, "count": len(results)})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    flagged_this_week = get_flagged_this_week()
    return jsonify({
        "total_analyzed": stats["total_analyzed"],
        "flagged": stats["flagged"],
        "flagged_this_week": flagged_this_week
    })


@app.route("/api/stats/reset", methods=["POST"])
def reset_stats():
    global stats
    stats = {"total_analyzed": 0, "flagged": 0, "flagged_items": []}
    return jsonify({"message": "Stats reset", "stats": stats})


@app.route("/api/log-detection", methods=["POST"])
def log_detection():
    """Log a detection from the extension to track stats."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400
    
    # Check if already logged today to avoid duplicates
    text_short = text[:100]
    today = datetime.now().date()
    
    is_duplicate = False
    for item in stats["flagged_items"]:
        item_date = datetime.fromisoformat(item["timestamp"]).date()
        if item["text"] == text_short and item_date == today:
            is_duplicate = True
            break
    
    if not is_duplicate:
        stats["flagged_items"].append({
            "timestamp": datetime.now().isoformat(),
            "text": text_short
        })
        stats["flagged"] += 1
    
    return jsonify({"status": "logged" if not is_duplicate else "duplicate", "flagged": stats["flagged"], "flagged_this_week": get_flagged_this_week()})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "models": {
            "svm": svm_model is not None,
            "muril": muril_model is not None,
            "llm": bool(OPENROUTER_API_KEY)
        }
    })


if __name__ == "__main__":
    print("Starting CyberGuard Backend...")
    print(f"OpenRouter API: {'YES' if OPENROUTER_API_KEY else 'NO'}")
    load_svm()
    load_muril()

    priority = []
    if muril_model: priority.append("MuRIL")
    if svm_model: priority.append("SVM")
    if OPENROUTER_API_KEY: priority.append("LLM (Hybrid)")
    priority.append("Keywords")

    print(f"Detection priority: {' > '.join(priority)}")
    print()

    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
