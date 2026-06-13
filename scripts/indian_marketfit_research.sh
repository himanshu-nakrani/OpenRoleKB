#!/usr/bin/env bash
# =============================================================================
# OpenRoleKB — India Market Retrieval Research
# =============================================================================
# Originally generated: 2026-06-07
# Companion report:    docs/india-retrieval-research.md  (or
#                      ~/Documents/OpenRoleKB_India_Retrieval_Research_20260607/)
#
# Purpose:
#   Self-contained, reproducible probe of which Indian tech companies are
#   reachable via the four major free public ATS APIs (Greenhouse, Lever,
#   Ashby, SmartRecruiters), plus a confirmation that the Adzuna India
#   endpoint exists.
#
# Usage:
#   bash scripts/indian_marketfit_research.sh                 # run all probes
#   bash scripts/indian_marketfit_research.sh greenhouse      # one ATS only
#   bash scripts/indian_marketfit_research.sh lever
#   bash scripts/indian_marketfit_research.sh ashby
#   bash scripts/indian_marketfit_research.sh smartrecruiters
#   bash scripts/indian_marketfit_research.sh adzuna
#   bash scripts/indian_marketfit_research.sh summary         # known-good slugs only
#
# Requirements: bash, curl, python3 (stdlib only).
#
# Read-only against external services. No DB writes. No state. Safe to re-run.
# =============================================================================

set -u
SECTION="${1:-all}"
CURL_TIMEOUT=5
PROBE_DELAY=0.05

# -----------------------------------------------------------------------------
# Candidate slug lists — assembled from public-knowledge Indian tech ecosystem
# (unicorns, soonicorns, YC/Sequoia/Peak XV/Accel India portfolio, listed IT
# services). Not exhaustive; false negatives possible if a real slug uses an
# unguessable internal codename.
# -----------------------------------------------------------------------------

INDIAN_TECH_SLUGS=(
  # Fintech
  razorpay zerodha cred jupiter slice navi paytm phonepe groww uni stashfin
  niro karbon karza digio leadsquared smallcase yubi mobikwik kissht juspay
  zerodhabroking angelone moneyview refyne ditto acko digit open

  # Commerce / e-commerce
  meesho swiggy zomato flipkart blinkit zepto boat khatabook urbancompany
  porter rapido cars24 spinny dunzo nykaa lenskart livspace freecharge
  ofbusiness inshorts

  # SaaS / dev tools / B2B
  freshworks postman whatfix chargebee browserstack druva highradius hasura
  rocketlane setu cleartax leadsquared mindtickle clevertap fynd plivo
  gupshup hike

  # Edtech
  upgrad byjus unacademy whitehat masaischool scaler classplus physicswallah
  pluang

  # Space / deeptech
  pixxel agnikul skyroot

  # Apps / consumer
  cred dream11 mpl gameskraft apna porter mygate yulu coinswitch wazirx

  # IT services (selective — only ones likely to publish on Western ATS)
  tcs fivetran
)

# Slugs that returned HTTP 200 with >=1 open job during the 2026-06-07 probe.
# Keep this list in sync with findings so `summary` mode is fast.
VERIFIED_GREENHOUSE=(phonepe postman groww druva highradius slice karbon fivetran tcs)
VERIFIED_ASHBY=(scaler navi ditto)
VERIFIED_SMARTRECRUITERS=(freshworks unacademy whatfix cars24)
VERIFIED_LEVER=()  # none confirmed in 2026-06-07 probe — see report Finding 2

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

probe_greenhouse() {
  local slug="$1"
  local url="https://boards-api.greenhouse.io/v1/boards/$slug/jobs"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" "$url")
  if [ "$code" = "200" ]; then
    local count
    count=$(curl -s --max-time "$CURL_TIMEOUT" "$url" | python3 -c "
import sys, json
try: print(len(json.load(sys.stdin).get('jobs', [])))
except: print(0)
")
    if [ "${count:-0}" -gt 0 ]; then
      printf "  %-24s -> %s jobs\n" "$slug" "$count"
      return 0
    fi
  fi
  return 1
}

probe_lever() {
  local slug="$1"
  local resp count
  resp=$(curl -s --max-time "$CURL_TIMEOUT" "https://api.lever.co/v0/postings/$slug?mode=json")
  count=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(len(d) if isinstance(d, list) else 0)
except: print(0)
")
  if [ "${count:-0}" -gt 0 ]; then
    printf "  %-24s -> %s jobs\n" "$slug" "$count"
    return 0
  fi
  return 1
}

probe_ashby() {
  local slug="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$CURL_TIMEOUT" \
    "https://api.ashbyhq.com/posting-api/job-board/$slug")
  if [ "$code" = "200" ]; then
    local count
    count=$(curl -s --max-time "$CURL_TIMEOUT" \
      "https://api.ashbyhq.com/posting-api/job-board/$slug" | python3 -c "
import sys, json
try: print(len(json.load(sys.stdin).get('jobs', [])))
except: print(0)
")
    if [ "${count:-0}" -gt 0 ]; then
      printf "  %-24s -> %s jobs\n" "$slug" "$count"
      return 0
    fi
  fi
  return 1
}

probe_smartrecruiters() {
  local slug="$1"
  local url="https://api.smartrecruiters.com/v1/companies/$slug/postings"
  local resp count
  resp=$(curl -s --max-time "$CURL_TIMEOUT" "$url")
  count=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('totalFound', 0))
except: print(0)
")
  if [ "${count:-0}" -gt 0 ]; then
    printf "  %-24s -> %s jobs\n" "$slug" "$count"
    return 0
  fi
  return 1
}

run_probe() {
  local name="$1"
  local probe_fn="$2"
  shift 2
  local slugs=("$@")
  local hits=0 total=${#slugs[@]}

  echo "=============================================================="
  echo "  $name probe — testing ${total} candidate slugs"
  echo "=============================================================="
  for slug in "${slugs[@]}"; do
    if "$probe_fn" "$slug"; then
      hits=$((hits + 1))
    fi
    sleep "$PROBE_DELAY"
  done
  echo "--------------------------------------------------------------"
  echo "  $name verified hits: $hits / $total"
  echo
}

run_adzuna_probe() {
  echo "=============================================================="
  echo "  Adzuna country-code probe (confirms India endpoint exists)"
  echo "=============================================================="
  echo "  Hitting /jobs/{country}/search/1 with invalid creds."
  echo "  AUTH_FAIL = valid country, just needs an API key."
  echo "  Other errors = country not supported."
  echo
  for country in us gb in au ca de fr nl sg za mx; do
    local resp err
    resp=$(curl -s --max-time "$CURL_TIMEOUT" \
      "https://api.adzuna.com/v1/api/jobs/$country/search/1?app_id=invalid&app_key=invalid")
    err=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('exception', '?'))
except: print('parse_err')
")
    printf "  %s -> %s\n" "$country" "$err"
  done
  echo
}

# -----------------------------------------------------------------------------
# Verified-results summary (no network calls — uses cached lists above)
# -----------------------------------------------------------------------------

print_summary() {
  cat <<'EOF'
==============================================================
  Verified Indian-tech ATS slugs (probed 2026-06-07)
==============================================================

Greenhouse — 9 companies, ~602 jobs (counts from 2026-06-07 probe):
  phonepe       71
  postman       116
  groww         16
  druva         30
  highradius    83
  slice         75
  karbon        22
  fivetran      118  (US-HQ, large India team)
  tcs           71   (under-represents true volume; bulk hiring on careers.tcs.com)

Ashby — 3 companies, ~32 jobs:
  scaler        2
  navi          6
  ditto         24

SmartRecruiters — 4 companies, ~49 jobs:
  freshworks    44   (Chennai-HQ, primary global ATS for them)
  unacademy     3
  whatfix       1
  cars24        1

Lever — 0 confirmed Indian-tech slugs across 126 candidates probed.
  See report Finding 2 — likely cause is Indian tech skipped Lever
  between Naukri-era and Greenhouse/Ashby. Not worth more discovery
  effort for India coverage.

==============================================================
  Walled off — DO NOT attempt to scrape these
==============================================================
  Naukri.com    HTTP 403 to docs, TOS prohibits automated access
  Wellfound     HTTP 429, Retry-After: 3600s — active rate-limiting
  LinkedIn      Public jobs API deprecated, enterprise partners only

  Indian domestic ATSes (Darwinbox, Keka, Zoho Recruit) do not
  expose public slug-scoped job-board APIs. Account-scoped only.

==============================================================
  Reachable but commercial-gated
==============================================================
  Adzuna /jobs/in/  — endpoint confirmed reachable, ~250 free
                     calls/mo dev tier, higher volume requires
                     partnerships@adzuna.com negotiation.

==============================================================
  Immediate action (30 min, zero risk)
==============================================================
  Append to scripts/ingest-greenhouse.ts DEFAULT_SLUGS:

    "phonepe", "postman", "groww", "druva", "highradius",
    "slice", "karbon", "fivetran", "tcs",

  Expected outcome: corpus 3,972 -> ~4,574 jobs, meaningful
  India tech coverage from ~0 to ~600 verified rows.

EOF
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

case "$SECTION" in
  greenhouse)
    run_probe "Greenhouse" probe_greenhouse "${INDIAN_TECH_SLUGS[@]}"
    ;;
  lever)
    run_probe "Lever" probe_lever "${INDIAN_TECH_SLUGS[@]}"
    ;;
  ashby)
    run_probe "Ashby" probe_ashby "${INDIAN_TECH_SLUGS[@]}"
    ;;
  smartrecruiters|sr)
    run_probe "SmartRecruiters" probe_smartrecruiters "${INDIAN_TECH_SLUGS[@]}"
    ;;
  adzuna)
    run_adzuna_probe
    ;;
  summary)
    print_summary
    ;;
  all)
    run_probe "Greenhouse"       probe_greenhouse       "${INDIAN_TECH_SLUGS[@]}"
    run_probe "Lever"            probe_lever            "${INDIAN_TECH_SLUGS[@]}"
    run_probe "Ashby"            probe_ashby            "${INDIAN_TECH_SLUGS[@]}"
    run_probe "SmartRecruiters"  probe_smartrecruiters  "${INDIAN_TECH_SLUGS[@]}"
    run_adzuna_probe
    print_summary
    ;;
  *)
    echo "Usage: $0 [all|greenhouse|lever|ashby|smartrecruiters|adzuna|summary]" >&2
    exit 1
    ;;
esac
