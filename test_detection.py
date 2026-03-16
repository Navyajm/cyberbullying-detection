import requests
import json
import time

API_URL = "http://localhost:5000/api/detect"

test_cases = [
    # Strong Hinglish Abuse (Should be flagged by keywords or LLM)
    "tu bahut chutiya hai", 
    
    # Mild Hinglish (Should capture nuance)
    "tera dimaag kharaab hai kya",
    
    # Positive Hinglish (Should NOT be flagged)
    "kya baat hai bhai amazing video",
    
    # Ambiguous / Slang (Hybrid check)
    "abe saale",
    
    # Short Phrase (Should pass new filtering)
    "bakwas hai",
    
    # English (Should be ignored by Hinglish filter unless mixed)
    "You are stupid",
]

def run_tests():
    print(f"Testing API at {API_URL}...\n")
    
    for text in test_cases:
        print(f"Text: '{text}'")
        try:
            # First try without LLM to see local model behavior
            payload = {"text": text, "use_llm": True}
            response = requests.post(API_URL, json=payload)
            
            if response.status_code == 200:
                result = response.json()
                print(f"  Result: {result.get('is_cyberbullying')}")
                print(f"  Method: {result.get('method')}")
                print(f"  Conf:   {result.get('confidence')}")
                print(f"  Expl:   {result.get('explanation')}")
            else:
                print(f"  Error: {response.status_code} - {response.text}")
                
        except Exception as e:
            print(f"  Failed to connect: {e}")
            
        print("-" * 40)

if __name__ == "__main__":
    run_tests()
