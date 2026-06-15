import json
import sys
from urllib.parse import urlparse
import os

# Trusted sources that can bypass human review block (Layer 2)
TRUSTED_DOMAINS = ['wikipedia.org', 'sec.gov', 'wikidata.org']

def get_modified_domains():
    db_path = os.path.join(os.path.dirname(__file__), '../argus-extension/database.json')
    with open(db_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def main():
    print("Layer 2: Automated Citation Check initialized.")
    db = get_modified_domains()
    errors = []
    
    for domain, data in db.items():
        if data.get('trust_level') == 'Community Sourced':
            source = data.get('source', '')
            if not source.startswith('http'):
                errors.append(f"Domain '{domain}' is missing a valid source URL. Rejecting PR.")
                continue
                
            source_domain = urlparse(source).netloc.replace('www.', '').lower()
            is_trusted = False
            for td in TRUSTED_DOMAINS:
                if source_domain.endswith(td):
                    is_trusted = True
                    break
                    
            if not is_trusted:
                errors.append(f"Domain '{domain}' has an untrusted source: {source}. Must be from verified registries {TRUSTED_DOMAINS}")

    if errors:
        print(" PR Verification Failed. Bad submissions detected:")
        for e in errors:
            print(f" - {e}")
        sys.exit(1)
    else:
        print("All Community Sourced entries have trusted sources. Passing to human review.")
        sys.exit(0)

if __name__ == '__main__':
    main()
