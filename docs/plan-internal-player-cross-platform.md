# Plano: Player interno (HTML5) + empacotamento macOS/Windows

## Context

Hoje o Stream Vault delega toda a reprodução ao **mpv externo** via socket Unix
(`/tmp/streamvault-*.sock`) com IPC JSON. Isso traz dois problemas:

1. **Linux-only.** Todo `mpv.rs` é `#[cfg(target_os = "linux")]`; macOS/Windows têm
   apenas stubs que retornam erro. O socket Unix e o caminho `/tmp` não existem no
   Windows (precisaria de named pipe).
2. **Baixa integração.** O vídeo abre numa janela externa do mpv, fora da UI do app.
   Notas, controles e progresso dependem de IPC com outro processo.

O objetivo é **construir um reprodutor dentro do app**, em React, usando o elemento
`<video>` da webview do Tauri. Isso (a) integra player + UI + notas numa só janela e
(b) **elimina o socket/binário externo do caminho de playback**, que era o único
bloqueio real para macOS/Windows. Foco confirmado pelo usuário: **MP4/H.264** —
containers/codecs exóticos (MKV/HEVC/AC3) ficam fora de escopo por enquanto.

Pré-requisito já satisfeito: `tauri.conf.json` tem `assetProtocol.enable: true` com
`scope: ["**"]`, e `convertFileSrc` já é exportado em `src/lib/api.ts:4`. Ou seja, a
webview já pode carregar qualquer arquivo local como `<video src=...>`.

## Abordagem recomendada

Substituir o mpv por um **player React em overlay** que ocupa a janela. O backend
deixa de gerenciar processo de vídeo; passa a apenas **persistir progresso** quando o
frontend reporta. ffmpeg/ffprobe continuam só para thumbnails (não bloqueiam playback).

### Parte A — Player interno (frontend)

**Novo componente** `src/components/PlayerOverlay.tsx` (consome o design system, não
o modifica — respeita a regra de ownership de `components/`):

- Renderiza `<video>` em fullscreen-overlay com `src={convertFileSrc(item.filePath)}`.
- Controles custom em React: play/pause, timeline com scrub, volume, velocidade,
  fullscreen, botão "fechar". Reaproveita `ProgressBar` e tokens de tema existentes.
- `autoPlay` + `currentTime = resumeSeconds` no evento `loadedmetadata` (resume).
- Listener `timeupdate` com **throttle de ~3s** (espelha o ciclo atual do mpv) chama
  uma nova API `reportProgress(itemId, position, duration)`.
- No `ended` (ou ao passar de 90%): persiste como completo e, se `auto_advance` estiver
  ligado e o item tiver `groupId`, busca `getNextItem` e troca a `src` — replicando
  `maybe_auto_advance` (hoje em `mpv.rs:245`) no frontend.
- **Notas (Alt+N):** passa a ser trivial — o player está na mesma webview. O handler de
  teclado já existe em `App.tsx:294`; em vez de IPC com mpv, ele lê `video.currentTime`
  e `video.pause()` direto do elemento. O fluxo de `note-capture-requested` vindo do mpv
  (`App.tsx:239`) deixa de ser necessário.

**Estado de "player ativo"** sobe para `App.tsx` (ou um context leve): qual item toca e
a ref do `<video>`, para que o atalho de notas e o command palette acessem.

**`DetailView.tsx:217`** (`onClick={() => playItem(item.id)}`) passa a abrir o
`PlayerOverlay` em vez de invocar o backend para spawnar mpv.

### Parte B — API e contrato (frontend + backend, mesmo commit)

Arquivos de contrato são sagrados — Rust e TS mudam juntos.

- **`src/lib/api.ts`**: remover `mpvGetPosition`, `mpvSetPaused`, `mpvSeek`,
  `mpvCurrentItemId` (viram estado local do React). `playItem`/`playItemAt` deixam de
  spawnar processo; manter apenas o que o overlay precisa (resolver `filePath` +
  `resumeSeconds` — pode reusar `getGroup`/item já carregado, ou um command leve
  `get_item(id)`). Adicionar `reportProgress(itemId, position, duration)`.
- **`src-tauri/src/commands.rs`**: substituir `play_item`/`play_item_at`/`spawn_play`
  (linhas 491–551) e os comandos `mpv_*` (linhas 821–862) por um único comando
  `report_progress` que chama `db.upsert_progress(...)` + emite o evento `item-progress`
  (reusa `ProgressUpdate` de `models.rs:118` — **evento e shape preservados**, então
  `App.tsx:81`/`onItemProgress` não mudam). Atualizar o `invoke_handler` em `lib.rs`.
- **`src-tauri/src/mpv.rs`**: removido por completo (todo o módulo era o wrapper do
  processo externo). Tirar `mod mpv;` e o `PlaybackState` registrado no `setup`.
- **`is_completed` (≥90%, `mpv.rs:336`)**: reimplementar a regra no `report_progress`
  (backend) — manter a verdade do "completo" no backend, frontend só envia posição.

### Parte C — Empacotamento macOS/Windows (`tauri.conf.json` + CI)

Com o mpv fora, o playback é portável de imediato. Resta o bundle:

- **`tauri.conf.json`**: adicionar seções `bundle.macOS` (`.app`/`.dmg`,
  `minimumSystemVersion`) e `bundle.windows` (NSIS `.msi`/`.exe`). Remover/ajustar a
  dependência `mpv` do `deb.depends` (linha 35) — sobra `ffmpeg` (só thumbnails). Ícones
  `.icns`/`.ico` já estão referenciados (linhas 42–43).
- **ffmpeg/ffprobe** (`thumbnails.rs`) continuam shell-out via PATH. São **não-fatais**
  (já tratam `ErrorKind::NotFound` e seguem sem thumbnail), então não bloqueiam o app em
  Win/Mac. Opção recomendada (fora do MVP, registrar como follow-up): empacotar como
  **Tauri sidecar** (`externalBin`) para garantir thumbnails sem instalação manual.
- **Build**: gerar artefatos por plataforma com `tauri build` em runners Windows/macOS
  (GitHub Actions matrix). Assinatura/notarização macOS fica como follow-up documentado,
  não bloqueia binário local.

## Arquivos-chave

| Ação | Arquivo |
|------|---------|
| Novo player React | `src/components/PlayerOverlay.tsx` |
| Abrir player / estado ativo | `src/App.tsx`, `src/views/DetailView.tsx` |
| API: remover mpv_*, add reportProgress | `src/lib/api.ts` |
| Comando report_progress + remover play_item/mpv_* | `src-tauri/src/commands.rs` |
| Remover módulo externo | `src-tauri/src/mpv.rs` (delete) + `lib.rs` |
| Persistência/regra de completo | reusar `db.upsert_progress`, `ProgressUpdate` (`models.rs:118`) |
| Bundle macOS/Windows | `src-tauri/tauri.conf.json` |

Reaproveitar: `convertFileSrc` (`api.ts:4`), evento `item-progress` + `onItemProgress`
(`api.ts:107`), `ProgressBar`, `getNextItem`/auto-advance, `NoteCaptureModal` e o handler
de teclado (`App.tsx:294`).

## Não-objetivos (por agora)

- Suporte a MKV/HEVC/AC3/DTS e transcode via ffmpeg em tempo real.
- Restringir o scanner: pode continuar listando `mkv/avi/mov`, mas itens fora de
  MP4/H.264 podem não tocar na webview — sinalizar isso na UI fica como follow-up.
- Assinatura/notarização e auto-update.

## Verificação

1. `cargo check` e `cargo clippy` em `src-tauri/` (contrato Rust compila sem o módulo mpv).
2. `pnpm lint` + build do frontend.
3. `pnpm tauri dev` no Linux: abrir um grupo, tocar um MP4 → vídeo aparece **dentro** da
   janela; scrub/pause/velocidade funcionam; fechar e reabrir retoma do ponto salvo
   (resume via `upsert_progress`).
4. Progresso: deixar tocar >3s, ver a barra de progresso atualizar no `DetailView`
   (evento `item-progress`). Passar de 90% → item marca como concluído; com auto-advance
   ligado, pula para o próximo.
5. Notas: Alt+N durante a reprodução pausa o vídeo e abre o `NoteCaptureModal` no
   timestamp correto; salvar e retomar.
6. `pnpm tauri build` em runner Windows e macOS → gera `.exe`/`.msi` e `.app`/`.dmg`;
   smoke test de reprodução de um MP4 em cada plataforma.
