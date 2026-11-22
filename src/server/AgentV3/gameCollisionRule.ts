/**
 * THE COLLISION RULE (admin 2026-11-22, verbatim: "jab bhi 2 object (kisi bhi game me) takrayenge to ek dusre ke aar paar
 * nahi jane chahiye, takkar honi chahiye ... hero road par chal rahi gadiyo se takrata nahi hai, na hi gadiya apas me
 * takrati hai"). Said to every game build and every later turn of a game, so a game NavBharatAI writes never lets two
 * solid things pass through each other. The kit holds the means: keepApart (moving things against each other),
 * markWorldCollider + sweepWorldCapsules (movers against walls and ground), the city traffic's own stop-and-push.
 */
export const GAME_COLLISION_RULE = '💥 NOTHING PASSES THROUGH ANYTHING. In this game, two solid things that meet COLLIDE - the player and a car,'
  + ' two cars, a person and a wall, an enemy and the player, a ball and a bat. Every frame, give every moving thing (player, the car they drive,'
  + ' enemies, animals, NPCs, thrown or rolling objects) to keepApart([{ object, radius }, ...]) from src/game/three/collision.ts (mark a parked'
  + ' or heavy thing fixed: true), and move custom movers with sweepWorldCapsules against the walls. Use its return value for the hit (a bump'
  + ' sound, damage, a ragdoll, a score) when the game has one. City traffic already stops for and pushes out the player. In a 2D game, use the'
  + ' kit\'s 2D physics (src/game/2d/physics.ts) the same way. Never let a moving object\'s position be set straight through another one.';
