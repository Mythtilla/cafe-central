/* Optional: fills the menu with ILLUSTRATIVE dishes so you can demo the live site. Run: npm run seed:demo
 * No prices on purpose — real prices must come from the café. Delete or edit anything from /admin. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';

const dir = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));
const db = openDatabase(dir);
const DEMO = {
  'Cafés': [['Bica', 'Short and hot, pulled to order.', []], ['Galão', 'Milky coffee in a tall glass.', ['leite']], ['Meia de leite', 'Half coffee, half milk, in a cup.', ['leite']], ['Abatanado', 'A longer bica.', []]],
  'Pastelaria': [['Pastel de nata', 'Warm custard tart with cinnamon.', ['glúten', 'ovos', 'leite']], ['Bola de Berlim', 'Doughnut with egg-cream filling.', ['glúten', 'ovos', 'leite']], ['Folhado misto', 'Puff pastry with ham and cheese.', ['glúten', 'leite']]],
  'Salgados': [['Tosta mista', 'Toasted ham and cheese sandwich.', ['glúten', 'leite']], ['Rissol de carne', 'Crisp fried meat turnover.', ['glúten', 'leite']]],
};
let added = 0;
for (const [cat, rows] of Object.entries(DEMO)) {
  const c = db.prepare('SELECT id FROM categories WHERE name = ?').get(cat);
  if (!c) continue;
  rows.forEach(([name, description, allergens], i) => {
    if (db.prepare('SELECT 1 x FROM items WHERE category_id = ? AND name = ?').get(c.id, name)) return;
    db.prepare('INSERT INTO items (category_id, name, description, allergens, sort) VALUES (?,?,?,?,?)').run(c.id, name, description, JSON.stringify(allergens), i + 1);
    added++;
  });
}
console.log(`Seeded ${added} illustrative dishes (no prices). Edit them in /admin.`);
