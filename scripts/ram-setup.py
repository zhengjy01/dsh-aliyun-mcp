#!/usr/bin/env python3
"""dsh-aliyun — RAM sub-account AccessKey bootstrap.

Creates a RAM sub-account, attaches the system policy
`AliyunOpenAPIMCPServerStaticCredentialAccess` (ram:GenerateAccessToken + openapiexplorer:*),
creates an AccessKey for it, and writes it to the dsh-aliyun plugin store
(~/.dsh/dsh-aliyun.json, mode 0600) in the exact shape the plugin expects.

Security
--------
* The *plugin runtime* key is the sub-account key we create — never the main
  (root) account key.
* The script still needs *some* credential to talk to Alibaba Cloud: set a
  BOOTSTRAP credential below. Prefer an existing RAM user with ram:* admin; the
  main account key also works but is only used once here and is never persisted.
* The secret is written to a 0600 file and only ever shown masked.

Usage
-----
    export ALIBABA_CLOUD_ACCESS_KEY_ID=<bootstrap AK>
    export ALIBABA_CLOUD_ACCESS_KEY_SECRET=<bootstrap SK>
    python3 scripts/ram-setup.py [--user aliyun-mcp] \
        [--policy AliyunOpenAPIMCPServerStaticCredentialAccess] \
        [--store ~/.dsh/dsh-aliyun.json]

Idempotent: if the user already exists / the policy is already attached, it
continues. Re-running creates a fresh AccessKey each time (old key stays valid;
delete it manually if you want rotation).

Requires only the Python standard library.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http import HTTPStatus

VERSION = "2015-05-01"
ENDPOINT = "https://ram.aliyuncs.com/"
DEFAULT_USER = "aliyun-mcp"
DEFAULT_POLICY = "AliyunOpenAPIMCPServerStaticCredentialAccess"
DEFAULT_PROXY_COMMAND = "uvx"
DEFAULT_PROXY_ARGS = ["alibabacloud.mcp-proxy@latest"]


# --------------------------------------------------------------------------- #
# Alibaba Cloud RPC signature (Signature Version 1.0, HMAC-SHA1).             #
# Validated end-to-end against the live API: a request signed with an unknown #
# key returns InvalidAccessKeyId.NotFound (auth reached), not                  #
# SignatureDoesNotMatch.                                                       #
# --------------------------------------------------------------------------- #
def _pub(value):
    return urllib.parse.quote(value, safe="").replace("+", "%20").replace("*", "%2A").replace("%7E", "~")


def _sign(access_key_id, access_key_secret, action, params=None, version=VERSION):
    """Return the request querystring (including Signature) for an RPC call."""
    p = {
        "AccessKeyId": access_key_id,
        "Action": action,
        "Format": "XML",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": os.urandom(16).hex(),
        "SignatureVersion": "1.0",
        "Timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": version,
    }
    if params:
        p.update(params)
    qs = "&".join(_pub(k) + "=" + _pub(v) for k, v in sorted(p.items()))
    string_to_sign = "GET&%2F&" + _pub(qs)
    signature = base64.b64encode(
        hmac.new((access_key_secret + "&").encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()
    p["Signature"] = signature
    return urllib.parse.urlencode(p)


def _call(access_key_id, access_key_secret, action, params=None):
    url = ENDPOINT + "?" + _sign(access_key_id, access_key_secret, action, params)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
    return _parse(body)


def _parse(body):
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return {"ok": False, "code": "Unknown", "message": body.strip(), "result": {}}
    node = root
    result = {}
    for child in root:
        tag = child.tag.split("}")[-1]
        if tag == "RequestId":
            result.setdefault("RequestId", child.text or "")
        elif tag == "Code":
            result["Code"] = child.text or ""
        elif tag == "Message":
            result["Message"] = child.text or ""
        else:
            result[tag] = child.text or ""
            for sub in child:
                subtag = sub.tag.split("}")[-1]
                result[subtag] = sub.text or ""
    # A top-level <Code> element marks an API error; success has none.
    ok = "Code" not in result
    return {"ok": ok, "code": result.get("Code"), "message": result.get("Message"), "result": result}


def ram(ak, sk, action, params=None):
    return _call(ak, sk, action, params)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", default=DEFAULT_USER, help="RAM sub-account name (default: %(default)s)")
    ap.add_argument("--policy", default=DEFAULT_POLICY,
                    help="System policy to attach (default: %(default)s)")
    ap.add_argument("--store", default=os.path.expanduser("~/.dsh/dsh-aliyun.json"),
                    help="dsh-aliyun plugin store path (default: %(default)s)")
    args = ap.parse_args()

    ak = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID", "").strip()
    sk = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET", "").strip()
    if not ak or not sk:
        sys.exit("ERROR: set ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET "
                 "(an existing RAM user with ram:* … or the main account key, which is used "
                 "only as a bootstrap and never stored).")

    # 1) Create the RAM sub-account (idempotent).
    r = ram(ak, sk, "CreateUser", {"UserName": args.user})
    if r["ok"] or (r["code"] and "AlreadyExists" in r["code"]):
        print(f"[1/4] RAM user '{args.user}' ready ({r['code'] or 'created'}).")
    else:
        sys.exit(f"[1/4] CreateUser failed: {r['code']} {r['message']}")

    # 2) Attach the system policy.
    r = ram(ak, sk, "AttachPolicyToUser", {
        "PolicyType": "System",
        "PolicyName": args.policy,
        "UserName": args.user,
    })
    if r["ok"] or (r["code"] and "AlreadyExist" in r["code"]):
        print(f"[2/4] Attached system policy '{args.policy}'.")
    else:
        sys.exit(f"[2/4] AttachPolicyToUser failed: {r['code']} {r['message']}")

    # 3) Create an AccessKey for the sub-account.
    r = ram(ak, sk, "CreateAccessKey", {"UserName": args.user})
    if not r["ok"]:
        sys.exit(f"[3/4] CreateAccessKey failed: {r['code']} {r['message']}")
    new_ak = r["result"].get("AccessKeyId")
    new_sk = r["result"].get("AccessKeySecret")
    if not new_ak or not new_sk:
        sys.exit(f"[3/4] CreateAccessKey returned no key: {r['result']}")
    print(f"[3/4] Created AccessKey {new_ak[:4]}****{new_ak[-4:]} for '{args.user}'.")

    # 4) Write the plugin store (mode 0600), exact shape the plugin expects.
    store = {
        "accessKeyId": new_ak,
        "accessKeySecret": new_sk,
        "keyUpdatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "serverUrl": "",
        "proxyCommand": DEFAULT_PROXY_COMMAND,
        "proxyArgs": DEFAULT_PROXY_ARGS,
    }
    os.makedirs(os.path.dirname(args.store), exist_ok=True)
    fd = os.open(args.store, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(store, fh, indent=2)
        fh.write("\n")
    print(f"[4/4] Wrote plugin store -> {args.store} (0600, masked below).")
    print()
    print("Done. AccessKeyId:", new_ak)
    print("AccessKeySecret: ******** (stored in the 0600 file)")
    print("RBAC             :", args.policy, "(ram:GenerateAccessToken + openapiexplorer:*)")
    print("Sub-account      :", args.user, "— NOT the main account key.")


if __name__ == "__main__":
    main()
