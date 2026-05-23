#!/usr/bin/env bash
# verify-deploy.sh — pollar GitHub Pages-deploy efter en push och rapporterar
# om versionen verkligen nått live. Körs efter `git push origin main`.
#
# Användning:  bash scripts/verify-deploy.sh
# Output:
#   ✓ v1.X deployed (Pages OK, raw confirms)
#   ✗ v1.X FAILED — error från Pages eller raw saknar version
#
# Beroenden: curl, grep. Ingen gh CLI behövs.

REPO="christopheralekji-coder/Thepenetrator"
SHA="$(git rev-parse HEAD)"
SHORT_SHA="${SHA:0:7}"
VERSION="$(grep -oE 'v1\.[0-9]+ ⚡' index.html | head -1 | awk '{print $1}')"

echo "Verifierar deploy för ${VERSION} (sha ${SHORT_SHA})..."

# Poll-loop: vänta tills pages-build är completed för vår SHA (max 180s)
for i in $(seq 1 36); do
  PAGES_JSON="$(curl -fsS "https://api.github.com/repos/${REPO}/actions/runs?per_page=20" 2>/dev/null)" || PAGES_JSON=""
  if [ -z "$PAGES_JSON" ]; then sleep 5; continue; fi

  # Hitta pages-run för vår sha
  PAGES_LINE="$(echo "$PAGES_JSON" | grep -B1 -A8 "\"head_sha\": \"$SHA\"" | grep -A1 "pages build" | tail -1)"
  if [ -z "$PAGES_LINE" ]; then
    # Pages-build kanske inte triggat än
    echo "  [${i}/36] Väntar på pages-build för ${SHORT_SHA}..."
    sleep 5
    continue
  fi

  CONCLUSION="$(echo "$PAGES_JSON" | awk -v sha="$SHA" '
    /"head_sha":/ && match($0, /"[a-f0-9]{40}"/) { current_sha = substr($0, RSTART+1, RLENGTH-2); }
    /"name": "pages build and deployment"/ { in_pages = 1; }
    in_pages && /"conclusion":/ && current_sha == sha {
      match($0, /"conclusion": "[^"]+"/);
      result = substr($0, RSTART+15, RLENGTH-16);
      print result;
      exit;
    }
    /"workflow_runs":/ { in_pages = 0; }
  ')"

  if [ -z "$CONCLUSION" ] || [ "$CONCLUSION" = "null" ]; then
    echo "  [${i}/36] Pages-build pågår..."
    sleep 5
    continue
  fi

  if [ "$CONCLUSION" = "success" ]; then
    # Verifiera att origin har korrekt version också
    RAW_VER="$(curl -fsS "https://raw.githubusercontent.com/${REPO}/main/index.html" 2>/dev/null | grep -oE 'v1\.[0-9]+ ⚡' | head -1 | awk '{print $1}')"
    if [ "$RAW_VER" = "$VERSION" ]; then
      echo "✓ ${VERSION} DEPLOYED — Pages success, raw confirms"
      exit 0
    else
      echo "✗ Pages success men raw visar ${RAW_VER} (förväntade ${VERSION})"
      exit 2
    fi
  fi

  echo "✗ ${VERSION} FAILED — Pages-build conclusion: ${CONCLUSION}"
  echo "  GitHub Actions: https://github.com/${REPO}/actions"
  exit 1
done

echo "✗ ${VERSION} TIMEOUT — pages-build inte klart efter 3 min"
exit 3
