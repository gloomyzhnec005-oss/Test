# Промты: спутники героя (К-1, К-2)

Спутник — маленькое существо, которое всегда ходит рядом с героем: видно всем игрокам, собирается в коллекцию, даёт небольшой бонус.
Рисуются **пиксель-артом, как герои и монстры** (а не как иконки) — иначе будут выделяться на карте. Иконку для окна коллекции я сделаю сам из первого кадра.

**Как отправлять:** одна картинка — один промт, PNG без сжатия. В сообщении — номер листа («К-1»). Я сам вырежу кадры и подключу.
Если генератор нарисовал другое число кадров или перепутал ряды — не страшно, напишите, что где.

Формат: каждый ряд — одно существо, **смотрит вправо**, 4 кадра движения (шаг или взмах крыльев, по кругу). Существа маленькие — примерно в половину роста героя.

---

## К-1: обычные спутники (зелёный фон, 6 шт.)

Бонусы (для меня, в промт не входят): дракончик +3% урона, лисёнок +5% золота, сова +5% опыта, голем +3% защиты, кот +3% крита, волчонок +3% скорости бега.

```
Pixel art fantasy RPG companion pet sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style and scale as small RPG creatures, crisp pixels, clean dark outline, rich colors.
Pure bright green background (#00FF00), no text, no grid lines, no shadows on the ground.
Strict grid: 6 rows × 4 frames, all frames the same size, generous empty green space between frames, creatures never touch.
Every creature faces RIGHT. In each row: frames 1–4 = a looping movement cycle (walking or flapping), small up-down bob, cute but heroic, small (half the height of a hero).
Row 1 — baby fire dragon: red-orange scales, tiny wings flapping, a small flame puff from the mouth in frame 3.
Row 2 — firefly fox kit: small orange fox with a glowing golden tail tip, trotting.
Row 3 — wise owl: brown-grey owl with tiny round glasses and a little scroll, flying with wing flaps.
Row 4 — tiny stone golem: grey mossy rock body with glowing blue rune eyes, heavy stomping steps.
Row 5 — phantom cat: translucent blue-violet ghost cat with a wispy tail, gliding walk.
Row 6 — frost wolf pup: white-blue fluffy pup with icy crystals on its back, running.
```
Файлы: `pet_dragon, pet_fox, pet_owl, pet_golem, pet_cat, pet_wolf`

---

## К-2: редкие спутники (пурпурный фон, 6 шт.)

Редкие — сильнее и наряднее: феникс, единорог, теневой дракон, золотой грифон, феечка, механический жук. Бонусы вдвое больше обычных; достаются за мировых боссов, сезонные ордена и в магазине.

```
Pixel art fantasy RPG companion pet sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style and scale as small RPG creatures, crisp pixels, clean dark outline, rich colors, magical glow and small sparkles around each creature.
Flat solid pure magenta background (#FF00FF), no text, no grid lines, no shadows on the ground.
Strict grid: 6 rows × 4 frames, all frames the same size, generous empty magenta space between frames, creatures never touch.
Every creature faces RIGHT. In each row: frames 1–4 = a looping movement cycle (walking or flapping), small up-down bob, majestic but small (half the height of a hero).
Row 1 — baby phoenix: fiery red-gold bird with a trail of embers, flapping flaming wings.
Row 2 — little unicorn: white pony with a shining golden horn and rainbow mane, trotting.
Row 3 — shadow dragonling: black-violet dragon with glowing purple eyes and smoky wings, flapping.
Row 4 — golden griffin cub: eagle head, lion body, golden feathers, flapping small wings while walking.
Row 5 — forest fairy: tiny glowing fairy with green-gold butterfly wings and a sparkling trail, fluttering.
Row 6 — clockwork beetle: brass and copper mechanical beetle with spinning gears and a glowing blue core, crawling.
```
Файлы: `pet_phoenix, pet_unicorn, pet_shadow, pet_griffin, pet_fairy, pet_beetle`
