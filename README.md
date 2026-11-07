# lilak_rack

The rack services of the [LILAK Web Portal](https://github.com/lilak-project): research records
kept as dense tables (racks) that share one set of tags.

| folder | what |
|---|---|
| `academic_activities/` | activities — talks, meetings, travel — and their calendar |
| `author_manager/` | people, affiliations and author groups |
| `reference_manager/` | papers and journals |
| `asset_manager2/` | equipment and assets |
| `note/` | notes and to-dos (markdown, `#tags`, `+projects`) |
| `project_manager/` | projects: a set of tags gathered across every service |
| `racklist/` | the frame every service above is drawn with (table, editors, calendar, tags, trash) |
| `rackstore/` | the backend they share: one record per file, trash, tags, folders (`pip install -e rackstore`) |
| `seed/` | each service's portal manifest |
| `scripts/new-rack-service.mjs` | a new rack service from a declaration |

The log bundle ([`lilak_log`](https://github.com/lilak-project/lilak_log): logbook, parameters) is drawn
with the same `racklist`/`rackstore` but installs, builds and shares its tags on its own.

They install **together** — from the portal's Service Manager ("rack services"), which clones this
checkout into the portal's stack (`web_service/lilak_rack`), builds each service and registers all
of them. A service is a `def.js` declaration fed to `<RackService>` (`racklist/service.jsx`), plus a
30-line backend on `rackstore`.

Runs inside the portal only: sign-in, the `/pp/<service>/<project>/` proxy, and sync come from the
portal; fonts and the language choice from the shared kit
[`lilak_ui`](https://github.com/lilak-project/lilak_ui) (aliased as `lilak-ui`, `LILAK_UI_PATH`).

```bash
npm install && npx vitest run                      # racklist tests
python3 -W ignore tests/test_store_security.py     # rackstore tests (portal venv)
```
