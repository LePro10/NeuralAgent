// The start page after load. Usage: node scripts/dev/shot.mjs home
export default async ({ shot, sleep }) => {
  await sleep(2200);
  await shot("start");
};
