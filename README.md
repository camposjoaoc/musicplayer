# MusicPlayer (Titan OS)

Web app pessoal para ouvir Spotify na Philips 55PUS8949/12 (Titan OS), feito para o controle remoto.
A TV vira um dispositivo **Spotify Connect** de verdade (via Web Playback SDK) e também controla
outros aparelhos (celular, PC, caixas de som).

**Requisitos:** conta **Spotify Premium** (exigência do SDK e, desde fev/2026, de qualquer app em modo dev),
hospedagem **HTTPS** (o DRM Widevine só funciona em contexto seguro) e acesso ao **DevView** do Titan OS.

## Como funciona

| Peça | O que faz |
|---|---|
| `index.html` + `js/app.js` | App da TV: menu lateral recolhível, Início ("Continuar ouvindo", favoritos por período), Busca (músicas, artistas, álbuns, playlists, podcasts, episódios, audiolivros), Biblioteca, Podcasts e audiolivros, Tocando agora (fila, letra, volume de outros aparelhos), Dispositivos, menu de ações ⋯ (tocar em seguida, adicionar a playlist, curtir/salvar, ir para álbum/artista/podcast) |
| `js/player.js` | Web Playback SDK (toca na TV) + Web API `/me/player` (controla qualquer dispositivo) |
| `js/nav.js` | Navegação espacial pelas setas do controle |
| `js/auth.js` | Login PKCE (sem segredo) — direto na TV ou pareando pelo celular via QR |
| `pair.html` / `callback.html` | Páginas que o celular abre durante o pareamento |
| `js/lyrics.js` | Letras sincronizadas via [LRCLIB](https://lrclib.net) (aberto, sem chave de API) |
| `js/icons.js` | Ícones do [Phosphor Icons](https://phosphoricons.com) (MIT), só os usados no app |

**Permissões:** se o app pedir para "entrar de novo", é porque ganhou recursos que precisam de
permissões novas da conta (podcasts, editar playlists, seguir). Basta aceitar e fazer o login de novo.

**Teclas do controle:** setas/OK navegam · Voltar volta (na tela inicial pergunta se quer sair) ·
Play/Pause/Stop/⏩/⏪ controlam a música · CH+/CH− próxima/anterior ·
🔴 Tocando agora · 🟢 Buscar · 🟡 Biblioteca · 🔵 Dispositivos.
Na barra de progresso da tela cheia, ◀ ▶ voltam/avançam 10 s.

**Login pelo celular:** a TV mostra um QR code. O celular faz o login no Spotify e devolve o
*authorization code* pelo relay público `ntfy.sh`, **cifrado com AES-GCM** usando uma chave que só existe
no QR code. O `code_verifier` do PKCE nunca sai da TV, então o código interceptado não serve para nada.

## 1. Criar o app no Spotify

1. Acesse <https://developer.spotify.com/dashboard> → **Create app**.
2. Marque **Web API** e **Web Playback SDK**.
3. Em **Redirect URIs**, cadastre (pode cadastrar os dois):
   - `https://SEU-USUARIO.github.io/spotify-tv/callback.html` (versão publicada)
   - `http://127.0.0.1:5173/callback.html` (teste no computador — o Spotify não aceita `localhost`)
4. Copie o **Client ID** para [js/config.js](js/config.js).
5. Se outra pessoa da casa for usar, adicione o e-mail dela em **User Management** (máx. 5 usuários em modo dev).

## 2. Testar no computador

```bash
python3 -m http.server 5173 --bind 127.0.0.1
# abra http://127.0.0.1:5173 no Chrome
```

Setas, Enter, Esc (= Voltar) e espaço (play/pause) simulam o controle. O login pelo celular só
funciona na versão publicada; no computador use "Entrar aqui".

## 3. Publicar (GitHub Pages)

```bash
git init && git add . && git commit -m "MusicPlayer"
gh repo create spotify-tv --public --source . --push
gh api repos/{owner}/spotify-tv/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

Em ~1 minuto o app fica em `https://SEU-USUARIO.github.io/spotify-tv/`.
O Client ID não é segredo (PKCE não usa client secret), então o repositório pode ser público.

## 4. Abrir na TV (DevView do Titan OS)

1. Crie uma conta em <https://partners.titanos.tv/> e, na seção **DevView**, peça acesso.
2. Em **DevView → Sandbox**, adicione um app com a URL publicada acima.
3. Na TV, abra o app **DevView** (fica em *Apps*, no carrossel Lifestyle) e anote o código na tela.
4. No portal, **Device Management → Add new device** e digite o código para parear a TV.
5. Abra o app pelo DevView. Dica: dá para fixar o DevView nos favoritos da tela inicial.

### Depurar na TV

No DevView, ligue **Enable Debug Mode**. No Chrome do computador (mesma rede), abra
`chrome://inspect/devices` → **Configure** → adicione `IP_DA_TV:9222` (ou `:7001`) e clique em *inspect*.
A tela **Dispositivos → Diagnóstico** do app mostra o status do player, do Widevine e o user agent.

## Limitações conhecidas

- **Faixas de playlists de outras pessoas** não são listadas (regra da API desde fev/2026), mas tocam
  normalmente pelo botão *Tocar*/*Aleatório*. Playlists suas mostram todas as faixas.
- "Top músicas do artista" e categorias/lançamentos saíram da API; a página do artista usa a busca.
- Busca retorna até 10 itens por tipo (limite atual da API).
- Se o SDK não iniciar na TV (ex.: o Spotify recusar o navegador), o app continua funcionando como
  **controle remoto** de outros dispositivos — a tela Dispositivos mostra o motivo.
- A letra do app oficial (Musixmatch) não está na API pública; o app usa o LRCLIB, que cobre bem músicas populares mas pode não ter algumas (aí mostra "Letra não encontrada").
- Podcasts em vídeo, clipes e Spotify Jam não estão disponíveis pela API pública.
