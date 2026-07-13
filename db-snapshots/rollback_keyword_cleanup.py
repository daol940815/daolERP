#!/usr/bin/env python3
# 2026-06-24 키워드 정리 롤백 — 변경 전 keywords로 복원 (REST PATCH, 컬럼 타입 무관)
# 사용: SB_URL=... SB_KEY=<service_role> python3 rollback_keyword_cleanup.py
import json,os,urllib.request
url=os.environ["SB_URL"]; key=os.environ["SB_KEY"]
roll=json.load(open(os.path.join(os.path.dirname(__file__),"keyword_cleanup_rollback__2026-06-24.json")))
H={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json","Prefer":"return=representation"}
for c,v in roll.items():
    req=urllib.request.Request(f"{url}/rest/v1/accounts?id=eq.{v['id']}&select=code,keywords",
        data=json.dumps({"keywords":v["old_keywords"]}).encode(),headers=H,method="PATCH")
    with urllib.request.urlopen(req,timeout=60) as r:
        print(c,"restored ->",len(json.load(r)[0]["keywords"]),"keywords")
print("rollback done")
