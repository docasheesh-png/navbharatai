/**
 * Library batch 12 (2026-11-21): VARIETY for big worlds (admin: "ok models streaming banao, phir library variety badhao").
 * A streamed world uses a few models many times, so what it needs is KINDS: nine kinds of home, eight kinds of vehicle
 * body, more people with their own look, trees, and the town buildings the library lacked. All kayquer kits, CC0.
 */
import { P, type Row } from './packs.mts';

export const REVIEWED_AT = '2026-11-21';
const r = (id: string, pack: Row['pack'], file: string, subjects: string[], category: Row['category'], height: number): Row => ({ id, pack, file: `${file}.glb`, subjects, category, height });
const person = (id: string, file: string, subjects: string[], height: number): Row => ({ id, pack: P.people, file: `${file}.glb`, subjects, category: 'character', height, clips: { walk: 'andar', run: 'correr', idle: 'parado' } });
export const ROWS: Row[] = [
  // Homes — nine kinds, so a street is not one house repeated
  r('lib12-terraced-houses', P.buildings2, 'residencial/sobrados_geminados', ['terraced houses', 'row houses'], 'building', 8),
  r('lib12-shop-house', P.buildings2, 'residencial/sobrado_comercio', ['shop house', 'house with shop'], 'building', 8),
  r('lib12-house-with-yard', P.buildings2, 'residencial/casa_quintal', ['house with yard'], 'building', 5),
  r('lib12-porch-house', P.buildings2, 'residencial/casa_alpendre', ['porch house', 'veranda house'], 'building', 5),
  r('lib12-townhouse', P.buildings2, 'residencial/casa_sobrado', ['townhouse'], 'building', 8),
  r('lib12-small-house', P.buildings2, 'residencial/casa_popular', ['small house'], 'building', 4.5),
  r('lib12-bungalow', P.buildings2, 'residencial/casa_terrea', ['bungalow', 'one storey house'], 'building', 5),
  r('lib12-two-storey-house', P.buildings2, 'residencial/casa_dois_andares', ['two storey house'], 'building', 8),
  r('lib12-flat-roof-house', P.buildings2, 'residencial/casa_laje', ['flat roof house', 'concrete house'], 'building', 6),
  // Town buildings the library lacked
  r('lib12-office-tower', P.buildings2, 'comercial/torre_escritorios', ['corporate tower', 'glass tower'], 'building', 35),
  r('lib12-workshop', P.buildings2, 'industrial/oficina', ['workshop', 'car repair shop'], 'building', 6),
  r('lib12-water-tower', P.buildings2, 'industrial/caixa_dagua_taca', ['water tank tower'], 'building', 18),
  r('lib12-silo', P.buildings2, 'industrial/silo_industria', ['silo'], 'building', 16),
  r('lib12-shed', P.buildings2, 'industrial/galpao_pequeno', ['shed'], 'building', 6),
  r('lib12-research-centre', P.buildings2, 'industrial/centro_pesquisa', ['research centre', 'laboratory'], 'building', 10),
  r('lib12-beach-umbrella', P.buildings2, 'mobiliario/guarda_sol_a', ['beach umbrella', 'parasol'], 'street-prop', 2.4),
  // Trees
  r('lib12-small-tree', P.buildings2, 'verde/arvore_pequena', ['small tree'], 'vegetation', 4),
  r('lib12-flowering-tree', P.props2, 'arvores/ipe_amarelo', ['flowering tree', 'yellow tree'], 'vegetation', 7),
  r('lib12-araucaria', P.props2, 'arvores/araucaria', ['tall pine tree', 'araucaria'], 'vegetation', 12),
  r('lib12-fan-palm', P.props2, 'arvores/buriti', ['fan palm'], 'vegetation', 10),
  // Vehicles — one per body kind the library lacked
  r('lib12-pickup-truck', P.fleet, 'cuscuz', ['pickup truck'], 'vehicle-land', 1.7),
  r('lib12-delivery-van', P.fleet, 'cafune', ['delivery van', 'van'], 'vehicle-land', 2),
  r('lib12-minivan', P.fleet, 'pacoca', ['minivan', 'family van'], 'vehicle-land', 1.7),
  r('lib12-convertible', P.fleet, 'canjica', ['convertible', 'open top car'], 'vehicle-land', 1.3),
  r('lib12-jeep', P.fleet, 'borrasca', ['off road car', 'off roader'], 'vehicle-land', 1.8),
  r('lib12-rally-car', P.fleet, 'chispa', ['rally car', 'race car'], 'vehicle-land', 1.35),
  r('lib12-muscle-car', P.fleet, 'brasa', ['muscle car'], 'vehicle-land', 1.35),
  r('lib12-compact-sedan', P.fleet, 'quindim', ['compact sedan'], 'vehicle-land', 1.45),
  // People with their own look (walk, run, idle)
  person('lib12-young-man', 'multidao_07', ['young man', 'teenager'], 1.75),
  person('lib12-young-woman', 'rosa', ['young woman', 'girl'], 1.65),
  person('lib12-bearded-man', 'multidao_05', ['bearded man'], 1.78),
  person('lib12-bald-man', 'multidao_16', ['bald man'], 1.76),
  person('lib12-road-worker', 'multidao_18', ['road worker', 'traffic warden'], 1.76),
  person('lib12-grey-haired-woman', 'zelia', ['grey haired woman', 'woman in jacket'], 1.66),
  person('lib12-coach', 'rafa', ['sports coach'], 1.74),
  person('lib12-radio-host', 'lu', ['radio host', 'reporter'], 1.66),
  person('lib12-boss-woman', 'marta', ['boss woman', 'businesswoman'], 1.68),
  person('lib12-rich-man', 'cardim', ['rich man'], 1.75),
  person('lib12-female-racing-driver', 'piloto_m01', ['female racing driver'], 1.65),
  person('lib12-co-driver', 'caetano', ['co-driver'], 1.75),
];
