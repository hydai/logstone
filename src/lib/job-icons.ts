// Which job a character is playing, found from the job icon on the profile page.
//
// Lodestone names an icon by a hash, not by the job, so this table was made from the Class/Job
// page, where every row shows its icon next to the name. The keys are the ones
// /character/<id>/classjob uses (DarkKnight and BlackMage have no space). The base classes
// (Archer, Marauder and so on) are listed too, because a character who plays one shows its icon.
//
// Paladin is the one job whose icon no Class/Job page we read shows: each belongs to a character who
// has not unlocked Paladin, and its Paladin row shows the Gladiator icon. Its icon was found by
// elimination: the table had the other 42 of the 43 jobs and classes, and in 100 real search results
// this was the only active-job icon it did not know, seen only on characters at level 30 or above,
// the level at which a Gladiator becomes a Paladin.

/** Icon file name -> job key. */
export const JOB_ICON_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // Tank, with Gladiator, the class Paladin grows from
  'd0Tx-vhnsMYfYpGe9MvslemEfg.png': 'Paladin',
  'F5JzG9RPIKFSogtaKNBk455aYA.png': 'Gladiator',
  'A3UhbjZvDeN3tf_6nJ85VP0RY0.png': 'Warrior',
  '5CZEvDOMYMyVn2td9LZigsgw9s.png': 'DarkKnight',
  'hg8ofSSOKzqng290No55trV4mI.png': 'Gunbreaker',
  // Healer
  'i20QvSPcSQTybykLZDbQCgPwMw.png': 'WhiteMage',
  'WdFey0jyHn9Nnt1Qnm-J3yTg5s.png': 'Scholar',
  'erCgjnMSiab4LiHpWxVc-tXAqk.png': 'Astrologian',
  '_oYApASVVReLLmsokuCJGkEpk0.png': 'Sage',
  // Melee DPS
  'HW6tKOg4SOJbL8Z20GnsAWNjjM.png': 'Monk',
  'gX4OgBIHw68UcMU79P7LYCpldA.png': 'Dragoon',
  'Fso5hanZVEEAaZ7OGWJsXpf3jw.png': 'Ninja',
  'KndG72XtCFwaq1I1iqwcmO_0zc.png': 'Samurai',
  'cLlXUaeMPJDM2nBhIeM-uDmPzM.png': 'Reaper',
  'WojNTqMJ_Ye1twvkIhw825zc20.png': 'Viper',
  'OFfyg3oiCvw6DQmECas-wZv01A.png': 'Beastmaster',
  // Physical ranged DPS
  'KWI-9P3RX_Ojjn_mwCS2N0-3TI.png': 'Bard',
  'vmtbIlf6Uv8rVp2YFCWA25X0dc.png': 'Machinist',
  'HK0jQ1y7YV9qm30cxGOVev6Cck.png': 'Dancer',
  // Magical ranged DPS
  'V01m8YRBYcIs5vgbRtpDiqltSE.png': 'BlackMage',
  '4ghjpyyuNelzw1Bl0sM_PBA_FE.png': 'Summoner',
  's3MlLUKmRAHy0pH57PnFStHmIw.png': 'RedMage',
  'kLob-U-yh652LQPX1NHpLlUYQY.png': 'Pictomancer',
  'jdV3RRKtWzgo226CC09vjen5sk.png': 'BlueMage',
  // Crafting
  'YCN6F-xiXf03Ts3pXoBihh2OBk.png': 'Carpenter',
  'EEHVV5cIPkOZ6v5ALaoN5XSVRU.png': 'Blacksmith',
  'Rq5wcK3IPEaAB8N-T9l6tBPxCY.png': 'Armorer',
  'LbEjgw0cwO_2gQSmhta9z03pjM.png': 'Goldsmith',
  'ACAcQe3hWFxbWRVPqxKj_MzDiY.png': 'Leatherworker',
  'E69jrsOMGFvFpCX87F5wqgT_Vo.png': 'Weaver',
  'bBVQ9IFeXqjEdpuIxmKvSkqalE.png': 'Alchemist',
  '1kMI2v_KEVgo30RFvdFCyySkFo.png': 'Culinarian',
  // Gathering
  'aM2Dd6Vo4HW_UGasK7tLuZ6fu4.png': 'Miner',
  'jGRnjIlwWridqM-mIPNew6bhHM.png': 'Botanist',
  'B4Azydbn7Prubxt7OL9p1LZXZ0.png': 'Fisher',
  // Base classes
  'St9rjDJB3xNKGYg-vwooZ4j6CM.png': 'Marauder',
  'gl62VOTBJrm7D_BmAZITngUEM8.png': 'Conjurer',
  'iW7IBKQ7oglB9jmbn6LwdZXkWw.png': 'Pugilist',
  'tYTpoSwFLuGYGDJMff8GEFuDQs.png': 'Lancer',
  'wdwVVcptybfgSruoh8R344y_GA.png': 'Rogue',
  'ZpqEJWYHj9SvHGuV9cIyRNnIkk.png': 'Archer',
  'IM3PoP6p06GqEyReygdhZNh7fU.png': 'Thaumaturge',
  'VYP1LKTDpt8uJVvUT7OKrXNL9E.png': 'Arcanist',
});

/**
 * The job key for the icon URL of a character's active class or job, or null when the icon is
 * not in the table (a job added after the table was made) or there is no icon.
 * Only the file name counts: the folders in front of it and a query or fragment after it do not.
 */
export function activeJobKey(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  const path = iconUrl.split(/[?#]/, 1)[0];
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  // A plain lookup would answer "constructor" or "toString" with a function from Object.prototype.
  return Object.prototype.hasOwnProperty.call(JOB_ICON_KEYS, fileName) ? JOB_ICON_KEYS[fileName] : null;
}
