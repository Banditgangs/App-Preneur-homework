import urllib.request
import json
import time

url = 'http://localhost:8000/api/targets/'
data = json.dumps({'target_value': 'testphp.vulnweb.com', 'is_monitored': False}).encode('utf-8')
headers = {'Content-Type': 'application/json'}

print('--- TEST 1: Concurrency ---')
# First request
req1 = urllib.request.Request(url, data=data, headers=headers, method='POST')
res1 = urllib.request.urlopen(req1)
t1 = json.loads(res1.read().decode('utf-8'))
id1 = t1['id']
print(f'Request 1 ID: {id1}')

# Second request
req2 = urllib.request.Request(url, data=data, headers=headers, method='POST')
res2 = urllib.request.urlopen(req2)
t2 = json.loads(res2.read().decode('utf-8'))
id2 = t2['id']
print(f'Request 2 ID: {id2}')

if id1 == id2:
    print('PASS: IDs are identical.')
else:
    print('FAIL: IDs mismatch.')

print('\n--- TEST 2: AI Copilot Reality Check ---')
chat_url = 'http://localhost:8000/api/chat/'
chat_data = json.dumps({
    'target_id': id1,
    'messages': [
        {'role': 'user', 'content': 'Bulduğun gerçek zafiyetleri incele. Hedef sistemde tam olarak hangi URL\'de/dosyada ne açığı var ve bu spesifik açıktan nasıl sızabilirim? Bana genel geçer teoriler değil, bulduğun gerçek verileri söyle.'}
    ]
}).encode('utf-8')

req3 = urllib.request.Request(chat_url, data=chat_data, headers=headers, method='POST')
res3 = urllib.request.urlopen(req3)
reply = json.loads(res3.read().decode('utf-8'))
print(reply['reply'])
