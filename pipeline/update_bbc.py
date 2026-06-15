import json

db_path = r'e:\my_projects\argus\argus-extension\database.json'
with open(db_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Manually force bbc.com into the database as the Wikidata query limit may have missed it
data['bbc.com'] = {
    "owner": "British Broadcasting Corporation",
    "funding": "Publicly funded via television license fee",
    "source": "https://www.wikidata.org/",
    "trust_level": "Verified"
}

with open(db_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
