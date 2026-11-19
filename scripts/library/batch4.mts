/** Library batch 4 (2026-11-19): people with walk/run, everyday vehicles, boats and animals (kayquer kits, CC0). */
import { P, type Row } from './packs.mts';

export const REVIEWED_AT = '2026-11-19';
const person = (id: string, file: string, subject: string, height: number): Row => ({ id, pack: P.people, file: `${file}.glb`, subjects: [subject], category: 'character', height, clips: { walk: 'andar', run: 'correr', idle: 'parado' } });
const animal = (id: string, file: string, subject: string, height: number, pack = P.fauna): Row => ({ id, pack, file: `${file}.glb`, subjects: [subject], category: 'animal', height });
export const ROWS: Row[] = [
  // People (rigged, idle / walk / run)
  person('lib4-man-a', 'multidao_01', 'man', 1.77), person('lib4-man-b', 'multidao_15', 'man', 1.8), person('lib4-man-c', 'multidao_24', 'man', 1.8),
  person('lib4-woman-a', 'multidao_02', 'woman', 1.64), person('lib4-woman-b', 'multidao_09', 'woman', 1.68), person('lib4-woman-c', 'multidao_19', 'woman', 1.63),
  person('lib4-old-man', 'multidao_03', 'old man', 1.76), person('lib4-old-woman', 'multidao_04', 'old woman', 1.59),
  person('lib4-farmer', 'bento', 'farmer', 1.78), person('lib4-racing-driver', 'piloto_h01', 'racing driver', 1.8),
  person('lib4-mechanic', 'dito', 'mechanic', 1.8), person('lib4-worker', 'multidao_06', 'worker', 1.8), person('lib4-businessman', 'multidao_17', 'businessman', 1.77),
  // Everyday vehicles
  { id: 'lib4-ambulance', pack: P.city2, file: 'veiculos/ambulancia.glb', subjects: ['ambulance'], category: 'vehicle-land', height: 2.6 },
  { id: 'lib4-bicycle', pack: P.city2, file: 'veiculos/bicicleta.glb', subjects: ['bicycle'], category: 'vehicle-land', height: 1.05 },
  { id: 'lib4-bus', pack: P.city2, file: 'veiculos/onibus.glb', subjects: ['bus'], category: 'vehicle-land', height: 3.1 },
  { id: 'lib4-fire-truck', pack: P.city2, file: 'veiculos/caminhao_bombeiros.glb', subjects: ['fire truck'], category: 'vehicle-land', height: 3 },
  { id: 'lib4-garbage-truck', pack: P.city2, file: 'veiculos/caminhao_lixo.glb', subjects: ['garbage truck'], category: 'vehicle-land', height: 3 },
  { id: 'lib4-water-tanker', pack: P.city2, file: 'veiculos/caminhao_pipa.glb', subjects: ['water tanker'], category: 'vehicle-land', height: 2.8 },
  { id: 'lib4-electric-car', pack: P.city2, file: 'veiculos/carro_eletrico.glb', subjects: ['electric car'], category: 'vehicle-land', height: 1.5 },
  // Boats
  { id: 'lib4-fishing-boat', pack: P.city2, file: 'beira_rio/barco_pesca.glb', subjects: ['boat'], category: 'vehicle-water', height: 2 },
  { id: 'lib4-canoe', pack: P.city2, file: 'beira_rio/canoa.glb', subjects: ['canoe'], category: 'vehicle-water', height: 0.5 },
  { id: 'lib4-jetty', pack: P.city2, file: 'beira_rio/trapiche.glb', subjects: ['jetty'], category: 'building', height: 1.5 },
  // Farm and street animals
  animal('lib4-cow', 'fauna/vaca', 'cow', 1.4, P.props2), animal('lib4-dog', 'fauna/cachorro_caramelo', 'dog', 0.6, P.props2),
  animal('lib4-capybara', 'fauna/capivara', 'capybara', 0.6, P.props2), animal('lib4-toucan', 'fauna/tucano', 'toucan', 0.5, P.props2),
  animal('lib4-heron', 'fauna/garca', 'heron', 0.9, P.props2), animal('lib4-frog', 'fauna/sapo', 'frog', 0.12, P.props2),
  // Wild animals
  animal('lib4-jaguar', 'mamiferos/onca_pintada', 'jaguar', 0.8), animal('lib4-puma', 'mamiferos/onca_parda', 'puma', 0.8),
  animal('lib4-wolf', 'mamiferos/lobo_guara', 'wolf', 0.9), animal('lib4-deer', 'mamiferos/veado_campeiro', 'deer', 1.1),
  animal('lib4-monkey', 'mamiferos/macaco_prego', 'monkey', 0.5), animal('lib4-tapir', 'mamiferos/anta', 'tapir', 1),
  animal('lib4-sloth', 'mamiferos/preguica_de_coleira', 'sloth', 0.6), animal('lib4-armadillo', 'mamiferos/tatu_canastra', 'armadillo', 0.4),
  animal('lib4-peccary', 'mamiferos/queixada', 'wild pig', 0.6), animal('lib4-otter', 'mamiferos/ariranha', 'otter', 0.4),
  animal('lib4-bat', 'mamiferos/morcego_aurita', 'bat', 0.3),
  // Sea and river animals
  animal('lib4-whale', 'mamiferos/baleia_azul', 'whale', 5), animal('lib4-dolphin', 'mamiferos/boto_cinza', 'dolphin', 0.8),
  animal('lib4-manatee', 'mamiferos/peixe_boi_marinho', 'manatee', 1), animal('lib4-shark', 'peixes/tubarao_branco', 'shark', 1.3),
  animal('lib4-hammerhead', 'peixes/tubarao_martelo_grande', 'hammerhead shark', 1.2), animal('lib4-manta-ray', 'peixes/raia_manta_birostris', 'manta ray', 1),
  animal('lib4-seahorse', 'peixes/cavalo_marinho_reidi', 'seahorse', 0.15), animal('lib4-tuna', 'peixes/atum_azul', 'fish', 0.6),
  animal('lib4-sea-turtle', 'repteis/tartaruga_verde', 'turtle', 0.5), animal('lib4-crab', 'invertebrados/caranguejo_amarelo', 'crab', 0.15),
  animal('lib4-starfish', 'invertebrados/estrela_do_mar_brasiliensis', 'starfish', 0.05),
  // Reptiles, birds and insects
  animal('lib4-snake', 'repteis/jiboia_amarela', 'snake', 0.25), animal('lib4-lizard', 'repteis/iguaninha_azul', 'lizard', 0.15),
  animal('lib4-macaw', 'aves/arara_azul_de_lear', 'parrot', 0.6), animal('lib4-harpy-eagle', 'aves/gaviao_real', 'harpy eagle', 0.9),
  animal('lib4-duck', 'aves/pato_mergulhao', 'duck', 0.4), animal('lib4-hummingbird', 'aves/beija_flor_de_gravata_vermelha', 'hummingbird', 0.1),
  animal('lib4-butterfly', 'invertebrados/borboleta_azul', 'butterfly', 0.1), animal('lib4-dragonfly', 'invertebrados/libelula_rosea', 'dragonfly', 0.08),
  animal('lib4-ant', 'invertebrados/formiga_lucida', 'ant', 0.02),
];
