import './ui/style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const loading = document.getElementById('loading')!;

function fail(msg: string): void {
  loading.innerHTML = `<div style="max-width:520px;text-align:center;letter-spacing:.1em;font-size:14px;line-height:1.6">${msg}</div>`;
}

try {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    fail('LAST LIGHT needs WebGL2. Please use a recent Chrome, Edge, Firefox or Safari.');
  } else {
    const game = new Game(canvas);
    (window as unknown as { __ll: Game }).__ll = game;
    game
      .boot()
      .then(() => {
        loading.style.opacity = '0';
        setTimeout(() => loading.remove(), 700);
      })
      .catch((e) => {
        console.error(e);
        fail('Something went wrong while starting: ' + String(e));
      });
  }
} catch (e) {
  console.error(e);
  fail('Something went wrong while starting: ' + String(e));
}
