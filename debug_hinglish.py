from app import is_hinglish, TOXIC_HINDI, STRONG_HINDI_MARKERS

print(f"TOXIC_HINDI size: {len(TOXIC_HINDI)}")
if 'chutiya' in TOXIC_HINDI:
    print("'chutiya' IS in TOXIC_HINDI")
else:
    print("'chutiya' is NOT in TOXIC_HINDI")

text = "tu bahut chutiya hai"
result = is_hinglish(text)
print(f"Text: '{text}' -> is_hinglish: {result}")

text2 = "tera dimaag kharaab hai kya"
result2 = is_hinglish(text2)
print(f"Text: '{text2}' -> is_hinglish: {result2}")
