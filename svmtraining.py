"""
SVM Training for Hinglish Cyberbullying Detection (Baseline Model)
Uses TF-IDF features with Support Vector Machine classifier.
"""

import os
import joblib
import numpy as np
from sklearn.svm import SVC
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from datapreprocessing import load_and_preprocess


def train_svm(csv_path="finaldataset.csv"):
    """Train SVM model with TF-IDF features."""

    # Load data
    df = load_and_preprocess(csv_path)
    if df is None:
        return

    X = df['text'].values
    y = df['label'].values

    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    print(f"\nTraining set: {len(X_train)} samples")
    print(f"Test set: {len(X_test)} samples")

    # TF-IDF Vectorizer — tuned for Hinglish
    tfidf = TfidfVectorizer(
        max_features=10000,
        ngram_range=(1, 3),      # Unigrams, bigrams, trigrams
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
        analyzer='char_wb',       # Character n-grams at word boundaries (good for Hinglish)
    )

    X_train_tfidf = tfidf.fit_transform(X_train)
    X_test_tfidf = tfidf.transform(X_test)

    print(f"TF-IDF features: {X_train_tfidf.shape[1]}")

    # Train SVM
    print("\nTraining SVM...")
    svm = SVC(
        kernel='rbf',
        C=10,
        gamma='scale',
        probability=True,
        class_weight='balanced',
        random_state=42
    )
    svm.fit(X_train_tfidf, y_train)

    # Evaluate
    y_pred = svm.predict(X_test_tfidf)
    accuracy = accuracy_score(y_test, y_pred)

    print(f"\n{'='*50}")
    print(f"SVM MODEL RESULTS")
    print(f"{'='*50}")
    print(f"Accuracy: {accuracy:.4f}")
    print(f"\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=['Normal', 'Cyberbullying']))
    print(f"Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    # Save model and vectorizer
    os.makedirs("models", exist_ok=True)
    joblib.dump(svm, "models/svm_model.joblib")
    joblib.dump(tfidf, "models/tfidf_vectorizer.joblib")
    print(f"\nModel saved to models/svm_model.joblib")
    print(f"Vectorizer saved to models/tfidf_vectorizer.joblib")

    return accuracy


if __name__ == "__main__":
    train_svm()
