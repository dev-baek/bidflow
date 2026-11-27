import { readFileSync } from "node:fs";

export const auctionPhoto = {
  name: "camera.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(new URL("./auction-camera.jpg", import.meta.url)),
};

export const auctionPhotoWidth = 650;
