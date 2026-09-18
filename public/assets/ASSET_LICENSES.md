# Vendored visual assets

The GLB files in this folder are local copies of Kenney asset packs. The pack
license files are kept beside each pack in `nature/License.txt`,
`survival/License.txt`, and `industrial/License.txt`.

All three packs state Creative Commons Zero (CC0), allowing personal,
educational, and commercial use. Attribution is welcome but not required.

Sources:

- [Kenney Nature Kit](https://kenney.nl/assets/nature-kit), version 2.1,
  source archive:
  [kenney_nature-kit.zip](https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip)
- [Kenney Survival Kit](https://kenney.nl/assets/survival-kit), version 2.0,
  source archive:
  [kenney_survival-kit.zip](https://kenney.nl/media/pages/assets/survival-kit/4065a8185b-1712149243/kenney_survival-kit.zip)
- [Kenney City Kit Industrial](https://kenney.nl/assets/city-kit-industrial),
  version 2.0, source archive:
  [kenney_city-kit-industrial_2.0.zip](https://kenney.nl/media/pages/assets/city-kit-industrial/0ec35b139d-1788171848/kenney_city-kit-industrial_2.0.zip)

## Registry mapping

`src/game/assets/AssetRegistry.ts` maps local files to logical assets. The
important rule is that game generation refers to logical ids (`tree-round`,
`rock-large`, `cabin`, `bridge`, and so on), never to these filenames.

- `nature/`: trees, rocks, bushes, grass, flowers, logs, stumps, fences,
  signs, and bridge modules.
- `survival/`: resource bases, barrels, boxes, fences, signs, metal panels,
  and survival props.
- `industrial/`: building variants, containers, a windmill, and a water tower.

Characters currently retain the shared modular procedural visual as an explicit
fallback until a compatible rigged CC0 humanoid GLB is vendored and verified.
The character registry contract is already in place so the replacement does
not touch world-generation code.
