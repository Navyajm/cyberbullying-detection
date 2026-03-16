"""
Data Preprocessing for Hinglish Cyberbullying Detection
Loads and preprocesses the dataset for SVM and MuRIL training.
"""

import pandas as pd
import re
import os


def clean_text(text):
    """Clean and normalize Hinglish text."""
    if not isinstance(text, str):
        return ""
    # Lowercase
    text = text.lower()
    # Remove URLs
    text = re.sub(r'http\S+|www\.\S+', '', text)
    # Remove mentions and hashtags
    text = re.sub(r'@\w+|#\w+', '', text)
    # Remove special characters but keep basic punctuation
    text = re.sub(r'[^a-z0-9\s!?.,-]', '', text)
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def load_and_preprocess(csv_path="finaldataset.csv"):
    """
    Load and preprocess the dataset.
    Expected columns: 'text' and 'label' (0=normal, 1=cyberbullying)
    """
    if not os.path.exists(csv_path):
        print(f"Dataset not found at {csv_path}")
        print("Please place your finaldataset.csv in the project directory.")
        print("Expected format: CSV with 'text' and 'label' columns")
        return None

    df = pd.read_csv(csv_path)

    # Handle different column name formats
    col_map = {}
    for col in df.columns:
        lower = col.lower().strip()
        if lower in ['text', 'comment', 'message', 'sentence']:
            col_map[col] = 'text'
        elif lower in ['label', 'class', 'target', 'cyberbullying']:
            col_map[col] = 'label'
    df = df.rename(columns=col_map)

    if 'text' not in df.columns or 'label' not in df.columns:
        print(f"Could not find 'text' and 'label' columns. Found: {list(df.columns)}")
        return None

    # Drop missing values
    df = df.dropna(subset=['text', 'label'])

    # Clean text
    df['text'] = df['text'].apply(clean_text)

    # Remove empty texts
    df = df[df['text'].str.len() > 5]

    # Ensure label is integer
    df['label'] = df['label'].astype(int)

    print(f"Dataset loaded: {len(df)} samples")
    print(f"  Normal: {(df['label'] == 0).sum()}")
    print(f"  Cyberbullying: {(df['label'] == 1).sum()}")

    return df


if __name__ == "__main__":
    df = load_and_preprocess()
    if df is not None:
        print("\nSample data:")
        print(df.head(10).to_string())
        # Save cleaned version
        df.to_csv("cleaned_dataset.csv", index=False)
        print("\nSaved cleaned dataset to cleaned_dataset.csv")
