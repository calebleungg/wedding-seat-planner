import Phaser from 'phaser';
import { PlanScene } from './scenes/PlanScene';
import { Store, slugFromUrl } from './store';
import { bindUi } from './ui';

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const status = document.getElementById('status')!;
if (!url) {
  status.textContent = 'VITE_CONVEX_URL is not set';
  status.classList.add('err');
  throw new Error('VITE_CONVEX_URL is not set; run `npx convex dev` once to create .env.local');
}

const store = new Store(url, slugFromUrl());
const ui = bindUi(store);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1b22',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [],
});
const scene = new PlanScene();
game.scene.add('plan', scene, true, { store, events: ui.events });
ui.attach(scene);
// handy in the browser console
(window as unknown as { game: Phaser.Game }).game = game;
