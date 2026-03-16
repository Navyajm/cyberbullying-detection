"""
MuRIL Training for Hinglish Cyberbullying Detection (Advanced Model)
Fine-tunes google/muril-base-cased transformer for binary classification.
"""

import os
import numpy as np
import tensorflow as tf
from transformers import AutoTokenizer, TFAutoModel
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from datapreprocessing import load_and_preprocess

# Suppress TF warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

MAX_LENGTH = 128
BATCH_SIZE = 32
EPOCHS = 30
LEARNING_RATE = 2e-5
MODEL_NAME = "google/muril-base-cased"


def build_model():
    """Build MuRIL-based classification model."""
    # Load MuRIL base
    muril_base = TFAutoModel.from_pretrained(MODEL_NAME)

    # Freeze base layers
    for layer in muril_base.layers:
        layer.trainable = False

    # Build classification head
    input_ids = tf.keras.Input(shape=(MAX_LENGTH,), dtype=tf.int32, name='input_ids')
    attention_mask = tf.keras.Input(shape=(MAX_LENGTH,), dtype=tf.int32, name='attention_mask')

    outputs = muril_base(input_ids=input_ids, attention_mask=attention_mask)
    pooled = outputs.pooler_output

    x = tf.keras.layers.Dropout(0.3)(pooled)
    x = tf.keras.layers.Dense(128, activation='relu')(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    output = tf.keras.layers.Dense(1, activation='sigmoid')(x)

    model = tf.keras.Model(inputs=[input_ids, attention_mask], outputs=output)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss='binary_crossentropy',
        metrics=['accuracy']
    )

    return model


def train_muril(csv_path="finaldataset.csv"):
    """Train MuRIL model on the dataset."""

    # Load data
    df = load_and_preprocess(csv_path)
    if df is None:
        return

    texts = df['text'].values
    labels = df['label'].values

    # Split
    train_texts, test_texts, train_labels, test_labels = train_test_split(
        texts, labels, test_size=0.2, random_state=42, stratify=labels
    )

    print(f"\nTraining set: {len(train_texts)} samples")
    print(f"Test set: {len(test_texts)} samples")

    # Tokenize
    print(f"\nLoading MuRIL tokenizer: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    train_enc = tokenizer(
        list(train_texts), truncation=True, padding="max_length",
        max_length=MAX_LENGTH, return_tensors="tf"
    )
    test_enc = tokenizer(
        list(test_texts), truncation=True, padding="max_length",
        max_length=MAX_LENGTH, return_tensors="tf"
    )

    # Build model
    print("\nBuilding MuRIL model...")
    model = build_model()
    model.summary()

    # Callbacks
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor='val_loss', patience=5, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss', factor=0.5, patience=2
        )
    ]

    # Train
    print("\nTraining MuRIL model...")
    history = model.fit(
        [train_enc['input_ids'], train_enc['attention_mask']],
        train_labels,
        validation_split=0.15,
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1
    )

    # Evaluate
    y_pred_prob = model.predict([test_enc['input_ids'], test_enc['attention_mask']])
    y_pred = (y_pred_prob > 0.5).astype(int).flatten()
    accuracy = accuracy_score(test_labels, y_pred)

    print(f"\n{'='*50}")
    print(f"MuRIL MODEL RESULTS")
    print(f"{'='*50}")
    print(f"Accuracy: {accuracy:.4f}")
    print(f"\nClassification Report:")
    print(classification_report(test_labels, y_pred, target_names=['Normal', 'Cyberbullying']))
    print(f"Confusion Matrix:")
    print(confusion_matrix(test_labels, y_pred))

    # Save model and tokenizer
    os.makedirs("models", exist_ok=True)
    model.save("models/muril_model.h5")
    tokenizer.save_pretrained("models/muril_tokenizer")
    print(f"\nModel saved to models/muril_model.h5")
    print(f"Tokenizer saved to models/muril_tokenizer/")

    return accuracy


if __name__ == "__main__":
    train_muril()
