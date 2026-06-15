import json
import os
import requests
from urllib.parse import urlparse

# Define paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_FILE = os.path.join(SCRIPT_DIR, '../argus-extension/database.json')

def load_existing_db():
    if os.path.exists(DATABASE_FILE):
        with open(DATABASE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_db(data):
    with open(DATABASE_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def fetch_wikidata_media():
    """
    Queries Wikidata for entities classified as news media (or newspapers)
    that have an official website and an owner listed.
    """
    print("Fetching media data from Wikidata...")
    url = 'https://query.wikidata.org/sparql'
    
    # SPARQL Query: Instance of news media (Q11032), get website and owner
    query = """
    SELECT ?website ?ownerLabel WHERE {
      ?item wdt:P31 wd:Q11032 . 
      ?item wdt:P856 ?website .  
      ?item wdt:P127 ?owner .    
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } LIMIT 1000
    """
    headers = {
        'User-Agent': 'ArgusDataPipeline/1.0 (https://github.com/Adarsh-S-kmr/argus)',
        'Accept': 'application/json'
    }
    
    try:
        response = requests.get(url, params={'query': query}, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        extracted = {}
        for result in data['results']['bindings']:
            website = result.get('website', {}).get('value', '')
            owner = result.get('ownerLabel', {}).get('value', 'Unknown')
            
            if website:
                # Normalize domain
                domain = urlparse(website).netloc.replace('www.', '').lower()
                if domain and owner:
                    extracted[domain] = {
                        "owner": owner,
                        "funding": "Publicly available / Tracked via Wikidata",
                        "source": "https://www.wikidata.org/",
                        "trust_level": "Verified"
                    }
        print(f"-> Wikidata returned {len(extracted)} mapped domains.")
        return extracted
    except Exception as e:
        print(f"Error fetching from Wikidata: {e}")
        return {}

def fetch_media_ownership_monitor():
    """
    Placeholder: Scrapes RSF's Media Ownership Monitor global database.
    """
    print("Fetching from Reporters Without Borders (Media Ownership Monitor)...")
    # Implementation depends on RSF's public dataset exports or API
    return {}

def fetch_media_cloud_registries():
    """
    Placeholder: Integrates with Media Cloud's open registries.
    """
    print("Fetching from Media Cloud Registries...")
    # Requires API key and Media Cloud Python client
    return {}

def run_pipeline():
    print("Starting automated data pipeline for Argus...")
    db = load_existing_db()
    
    # 1. Fetch from automated sources
    wiki_data = fetch_wikidata_media()
    rsf_data = fetch_media_ownership_monitor()
    mc_data = fetch_media_cloud_registries()
    
    # 2. Merge data logically
    merged = {**wiki_data, **rsf_data, **mc_data}
    
    # 3. Apply to database, respecting manual overrides
    updated_count = 0
    for domain, info in merged.items():
        # Only overwrite if it doesn't exist, or if it isn't crowdsourced manually
        if domain not in db or db[domain].get('source') != 'manual':
            db[domain] = info
            updated_count += 1
            
    # 4. Save
    save_db(db)
    print(f"Pipeline complete. Updated/Added {updated_count} entries.")
    print(f"Total mapped domains in database.json: {len(db)}")

if __name__ == '__main__':
    run_pipeline()
