import json, os, sys, urllib.request

BASE_URL = os.environ['BASE_URL'].rstrip('/')
ADMIN_USER = os.environ['ADMIN_USER']
ADMIN_PASS = os.environ['ADMIN_PASS']
pack_file = sys.argv[1]

def call(path, method='GET', body=None, token=None):
    url = BASE_URL + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

pack = json.load(open(pack_file, encoding='utf-8'))

login = call('/api/auth/login', 'POST', {'username': ADMIN_USER, 'password': ADMIN_PASS})
token = login['token']
if not login['user']['is_admin']:
    raise SystemExit('This account is not an admin.')

existing = call('/api/admin/decks', token=token)['decks']
existing_by_name = {d['name']: d['id'] for d in existing}

total = 0
for deck in pack['decks']:
    name = deck['name']
    if name in existing_by_name:
        deck_id = existing_by_name[name]
        print(f'Using existing deck "{name}" (id {deck_id})')
    else:
        res = call('/api/admin/decks', 'POST', {'name': name, 'description': deck.get('description', '')}, token)
        deck_id = res['id']
        print(f'Created deck "{name}" (id {deck_id})')

    cards = [{'welsh': w, 'english': e} for w, e in deck['cards']]
    res = call('/api/admin/import', 'POST', {'deck_id': deck_id, 'cards': cards}, token)
    print(f'  -> imported {res["imported"]} cards')
    total += res['imported']

print(f'\nDone. Total cards imported: {total}')
