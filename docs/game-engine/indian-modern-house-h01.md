# Indian Modern House H01

- **Library ID:** `modern-house-h01`
- **Category:** building
- **Format:** self-contained glTF 2.0 binary (`.glb`)
- **Scale:** metres; declared model height 5.12 m
- **Geometry:** 86 authored box components grouped into 12 material meshes; 1,032 triangles
- **Reference:** owner-provided exterior elevation and floor-plan image
- **License:** CC BY 4.0; commercial use and redistribution in games and source exports are permitted with the supplied attribution
- **Build:** `node scripts/library/buildIndianModernHouse.mjs` deterministically writes the pinned file under `assets/game-models/`

The model follows the reference's pale plaster, mauve feature wall, flat parapet, horizontal upper louvers, porch canopy, stone column accents and entry steps. The interior includes a living area, two bedrooms, kitchen/dining fixtures and partition walls. The front entrance is an open 1.5 m passage; internal room passages are also left open.

**Gameplay boundary:** this is a static building asset. It has no animated door, loot containers, destructible parts, navmesh, baked lightmaps or authored physics body. The existing 3D game runtime marks building meshes as solid collision surfaces; the entrance and room gaps are modeled as actual geometry openings. Final character traversal, collision response, camera clearance, loot placement and mobile performance must still be verified in a completed generated game. It is not a claim of PUBG-equivalent interaction or device certification.

Attribution to include with redistributed copies: *Indian Modern House H01. Based on the reference image supplied by the NavBharatAI project owner; 3D adaptation authored for NavBharatAI. Attribution: NavBharatAI project owner. Licensed under CC BY 4.0.*
