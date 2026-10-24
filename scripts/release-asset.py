#!/usr/bin/env python3
"""Put a release asset where installs read it, without the artifact round trip.

GitHub's artifact storage is a detour: a job uploads, the publish job downloads it
all back, and then uploads the same bytes to the release. On a self-hosted runner
on a domestic link that is ~40 minutes of traffic for nothing. This writes the
asset straight to its release instead.

    release-asset.py draft  <tag> <notes-file>                 create the draft
    release-asset.py upload <tag> <file> [<file> ...]          add assets to it
    release-asset.py finish <tag> <checksums-in> <checksums-out>  sums from the
                                                                .sha256 artifacts
                                                                already assigned,
                                                                then publish

Every call reads GITHUB_TOKEN and GITHUB_REPOSITORY, which Actions provides.
"""

import json
import os
import sys
import urllib.request

API = "https://api.github.com/repos/{repo}/releases"


def request(url, method="GET", body=None, content_type=None):
    headers = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read() or b"{}")


def release(tag):
    for candidate in request(API.format(repo=os.environ["GITHUB_REPOSITORY"]) + "?per_page=100"):
        if candidate["tag_name"] == tag:
            return candidate
    raise SystemExit(f"no release for tag {tag}")


def draft(tag, notes_file):
    body = {
        "tag_name": tag,
        "name": tag,
        "body": open(notes_file).read(),
        "draft": True,
        "prerelease": "-" in tag,
    }
    made = request(
        API.format(repo=os.environ["GITHUB_REPOSITORY"]),
        method="POST",
        body=json.dumps(body).encode(),
        content_type="application/json",
    )
    print(f"draft {tag} (id {made['id']})")


def upload(tag, paths):
    found = release(tag)
    template = found["upload_url"].split("{")[0]
    for path in paths:
        name = os.path.basename(path)
        url = f"{template}?name={name}"
        with open(path, "rb") as f:
            request(url, method="POST", body=f.read(), content_type="application/octet-stream")
        print(f"uploaded {name} ({os.path.getsize(path)} bytes)")


def finish(tag, inputs, output):
    # The sums are what the gateway verifies downloads against (ADR 0019), so they are
    # computed from the bytes each job hashed, not from the bytes still in flight.
    lines = []
    for directory in inputs.split(","):
        for entry in sorted(os.listdir(directory)):
            if entry.endswith(".sha256"):
                lines.extend(open(os.path.join(directory, entry)).read().splitlines())
    open(output, "w").write("\n".join(line for line in lines if line.strip()) + "\n")
    print(f"{output}: {len(lines)} checksums")
    request(
        f"{API.format(repo=os.environ['GITHUB_REPOSITORY'])}/{release(tag)['id']}",
        method="PATCH",
        body=json.dumps({"draft": False}).encode(),
        content_type="application/json",
    )
    print(f"published {tag}")


if __name__ == "__main__":
    command, *rest = sys.argv[1:]
    {"draft": draft, "upload": upload, "finish": finish}[command](*rest)
