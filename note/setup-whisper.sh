#!/usr/bin/env sh
# note's dictation (녹음 → 받아쓰기) needs three things on the host, none of which
# come with the code: whisper.cpp (`whisper-cli`), ffmpeg, and one model file.
# Run once per machine:
#
#   sh setup-whisper.sh [DATA_ROOT]
#
# DATA_ROOT is the portal's data folder (default: the stack's `data/`, beside
# lilak_rack). The model goes to DATA_ROOT/note/models/, where the note server
# looks for it (or set NOTE_WHISPER_MODEL to a file elsewhere). Nothing needs a
# restart: the note server asks for these each time.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA=${1:-${PORTAL_DATA_ROOT:-$(cd "$HERE/../.." && pwd)/data}}
MODELS="$DATA/note/models"
MODEL=ggml-large-v3-turbo.bin
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL"
has() { command -v "$1" >/dev/null 2>&1 || [ -x "/opt/homebrew/bin/$1" ] || [ -x "/usr/local/bin/$1" ]; }

need=""
has whisper-cli || need="$need whisper-cpp"
has ffmpeg || need="$need ffmpeg"
if [ -n "$need" ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "→ brew install$need"
    brew install $need
  else
    echo "Not found:$need. Install them, then run this again:" >&2
    echo "  ffmpeg:      sudo apt install ffmpeg   (or your system's package)" >&2
    echo "  whisper-cli: git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp" >&2
    echo "               cmake -B build && cmake --build build -j --config Release" >&2
    echo "               sudo cp build/bin/whisper-cli /usr/local/bin/" >&2
    exit 1
  fi
fi

mkdir -p "$MODELS"
if [ -s "$MODELS/$MODEL" ]; then
  echo "✓ model already there: $MODELS/$MODEL"
else
  echo "→ downloading $MODEL (1.6 GB) to $MODELS"
  curl -L --fail -o "$MODELS/$MODEL.part" "$URL"
  mv "$MODELS/$MODEL.part" "$MODELS/$MODEL"
fi
echo "✓ dictation is ready. Reload the note page."
