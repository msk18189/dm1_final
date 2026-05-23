import requests

url = "http://localhost:8000/api/verify-repo"
payload = {
    "url": "https://github.com/mock-owner/mock-repo",
    "github_token": "mock_token"
}

print("Testing /api/verify-repo...")
try:
    resp = requests.post(url, json=payload)
    print("Status:", resp.status_code)
    print("Response:", resp.json())
except Exception as e:
    print("Error:", e)

url_analyze = "http://localhost:8000/api/analyze"
payload_analyze = {
    "url": "https://github.com/mock-owner/mock-repo",
    "github_token": "mock_token"
}

print("\nTesting /api/analyze...")
try:
    resp = requests.post(url_analyze, json=payload_analyze)
    print("Status:", resp.status_code)
    print("Response:", resp.json())
except Exception as e:
    print("Error:", e)