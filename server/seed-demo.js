/* Optional: fills the menu with ILLUSTRATIVE dishes so you can demo the live site. Run: npm run seed:demo
 * No prices on purpose — real prices must come from the café. Delete or edit anything from /admin. */
import { createPool, migrate } from './db.js';

const DEMO = {
  'Cafés': [['Bica', 'Short and hot, pulled to order.', []], ['Galão', 'Milky coffee in a tall glass.', ['leite']], ['Meia de leite', 'Half coffee, half milk, in a cup.', ['leite']], ['Abatanado', 'A longer bica.', []]],
  'Pastelaria': [['Pastel de nata', 'Warm custard tart with cinnamon.', ['glúten', 'ovos', 'leite']], ['Bola de Berlim', 'Doughnut with egg-cream filling.', ['glúten', 'ovos', 'leite']], ['Folhado misto', 'Puff pastry with ham and cheese.', ['glúten', 'leite']]],
  'Salgados': [['Tosta mista', 'Toasted ham and cheese sandwich.', ['glúten', 'leite']], ['Rissol de carne', 'Crisp fried meat turnover.', ['glúten', 'leite']]],
};

const pool = createPool(process.env);
await migrate(pool);

let added = 0;
for (const [cat, rows] of Object.entries(DEMO)) {
  const { rows: found } = await pool.query('SELECT id FROM categories WHERE name = $1', [cat]);
  const c = found[0];
  if (!c) continue;
  for (const [i, [name, description, allergens]] of rows.entries()) {
    const { rowCount } = await pool.query('SELECT 1 FROM items WHERE category_id = $1 AND name = $2', [c.id, name]);
    if (rowCount) continue;
    await pool.query(
      'INSERT INTO items (category_id, name, description, allergens, sort) VALUES ($1,$2,$3,$4,$5)',
      [c.id, name, description, JSON.stringify(allergens), i + 1]
    );
    added++;
  }
}

console.log(`Seeded ${added} illustrative dishes (no prices). Edit them in /admin.`);
await pool.end();
