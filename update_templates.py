import json
import os

# List of template files to update
template_files = [
    'd:/Coder/music_ball/public/templates/happy-birthday.json',
    'd:/Coder/music_ball/public/templates/happy-birthday-2.json',
    'd:/Coder/music_ball/public/templates/midi-jam.json'
]

for filepath in template_files:
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    
    try:
        # Read the JSON file
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Add readonly field if not present
        if 'readonly' not in data:
            data['readonly'] = False
        
        # Add maxHits to all bars
        if 'bars' in data:
            for bar in data['bars']:
                if 'maxHits' not in bar:
                    bar['maxHits'] = 0
        
        # Write back to file
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✓ Updated: {os.path.basename(filepath)}")
    except Exception as e:
        print(f"✗ Error updating {filepath}: {e}")

print("\nAll templates updated successfully!")
