# ElevenLabs straight from the API (stdlib only), for when the MCP connector is blocked or on a
# lower tier than the account key. Reads the key from ELEVENLABS_API_KEY; never pass it on the
# command line or write it to a file in the repo.
#
#   python videos/tools/elevenlabs.py tts   <voice_id> "<text>" out.mp3 [--model eleven_v3]
#   python videos/tools/elevenlabs.py sfx   "<prompt>" out.mp3 [--seconds 1.5]
#   python videos/tools/elevenlabs.py music "<prompt>" out.mp3 [--seconds 30]
#   python videos/tools/elevenlabs.py whoami
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io"


def key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if not k:
        sys.exit("set ELEVENLABS_API_KEY (the environment's secret), not a flag")
    return k


def call(path, body=None, out=None):
    req = urllib.request.Request(
        API + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"xi-api-key": key(), "content-type": "application/json"},
        method="GET" if body is None else "POST",
    )
    # behind the session proxy, its CA bundle is what verifies api.elevenlabs.io
    ca = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
    ctx = ssl.create_default_context(cafile=ca)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=300) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{e.code} {path}: {e.read().decode(errors='replace')[:400]}")
    if out is None:
        return json.loads(data)
    with open(out, "wb") as f:
        f.write(data)
    print(f"{out} ({len(data) // 1024} KB)")


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    cmd = sys.argv[1]
    if cmd == "whoami":
        s = call("/v1/user/subscription")
        print({k: s.get(k) for k in ("tier", "status", "character_count", "character_limit")})
    elif cmd == "tts":
        voice, text, out = sys.argv[2:5]
        call(f"/v1/text-to-speech/{voice}?output_format=mp3_44100_128", {"text": text, "model_id": arg("--model", "eleven_v3")}, out)
    elif cmd == "sfx":
        prompt, out = sys.argv[2:4]
        body = {"text": prompt, "prompt_influence": 0.4}
        if "--seconds" in sys.argv:
            body["duration_seconds"] = float(arg("--seconds", 1))
        call("/v1/sound-generation?output_format=mp3_44100_128", body, out)
    elif cmd == "music":
        prompt, out = sys.argv[2:4]
        body = {"prompt": prompt, "music_length_ms": int(float(arg("--seconds", 30)) * 1000), "force_instrumental": True}
        call("/v1/music?output_format=mp3_44100_128", body, out)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
