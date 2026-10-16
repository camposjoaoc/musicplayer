// Cole aqui o Client ID do app criado em https://developer.spotify.com/dashboard
export const CLIENT_ID = '5390904edaba4a7289f2d20815302b4b';

// Nome com que a TV aparece na lista de dispositivos do Spotify (celular, PC…)
export const DEVICE_NAME = 'Philips TV';

// Precisa estar cadastrado em "Redirect URIs" no dashboard do Spotify.
// É calculado a partir de onde o app está hospedado, ex.:
//   https://SEU-USUARIO.github.io/spotify-tv/callback.html
//   http://127.0.0.1:5173/callback.html   (teste local)
export const REDIRECT_URI = new URL('callback.html', location.href).href.split('?')[0];

// Opcional: chave da YouTube Data API v3 para o botão "Clipe" (veja o README).
// Restrinja a chave ao seu domínio no Google Cloud — ela fica visível no código.
export const YOUTUBE_API_KEY = 'AIzaSyD8xewY_Zsag34xGnIKWdCY_ozeew7TA9Y';

// Relay público usado só no login pelo celular. A mensagem vai criptografada
// (AES-GCM) com uma chave que existe apenas no QR code.
export const RELAY = 'https://ntfy.sh';

export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-follow-read',
];
