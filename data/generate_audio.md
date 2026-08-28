# Regenerating pronunciation audio

The MP3s in `audio/` are pre-generated offline with [Piper TTS](https://github.com/rhasspy/piper)
using Bangor University's open Welsh voice `cy_GB-gwryw_gogleddol-medium`
(from the `rhasspy/piper-voices` repo on Hugging Face). No external TTS
service is used at runtime — the server just serves these files.

Each file is named `sha1("cy_GB-gwryw_gogleddol-medium|" + welsh)` + `.mp3`,
where `welsh` is the card's exact `welsh` column value. The `/api/study/tts/:cardId`
endpoint computes the same hash to find the file, so **any change to a card's
Welsh text, or any new card, needs its MP3 regenerating**.

## Process (run on a machine with Node)

1. Download `piper_windows_amd64.zip` from the Piper GitHub releases and the
   voice files `cy_GB-gwryw_gogleddol-medium.onnx` + `.onnx.json` from
   `huggingface.co/rhasspy/piper-voices` (under `cy/cy_GB/gwryw_gogleddol/medium/`).
2. Fetch all cards (`id`, `welsh`) from `/api/admin/decks` + `/api/admin/cards?deck_id=`
   as an admin.
3. For each unique `welsh` text without an existing MP3:
   - Clean the text for speech: `->` becomes a pause (comma), `/` becomes `, `,
     parentheses are dropped, `...` becomes a comma.
   - Synthesise with Piper (`--json-input`, one line per file:
     `{"text": cleaned, "output_file": "<hash>.wav"}`).
   - Encode WAV → 48kbps mono MP3 (e.g. with the pure-JS `lamejs` package).
   - **Hash the original text, not the cleaned text.**
4. Drop the MP3s into `audio/`, commit and push.

The generation is idempotent — existing hashes are skipped, so re-running it
after adding cards only builds the new words.
