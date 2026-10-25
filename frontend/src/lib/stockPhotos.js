// Stock photos for the place tiles and section bars, loaded from Unsplash's image
// CDN (Unsplash License: free to use, no attribution required). They are not
// stored in the repo: scripts/check_private_files.py keeps every image out of Git
// so no building photo can slip in. These are generic stock scenes, never CDS.
const unsplash = (id, w) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&fm=jpg&fit=crop&auto=format`

const IDS = {
  classroom: '1580582932707-520aed937b7b',
  bookshelf: '1507842217343-583bb7270b66',
  food: '1504674900247-0877df9cc836',
  washroom: '1552321554-5fefe8c9ef14',
  libraryAisle: '1481627834876-b7833e8f5570',
  laptops: '1517245386807-bb43f82c33c4',
  latte: '1495474472287-4d71bcdd2085',
}

export const stockPhoto = (name, w = 560) => (IDS[name] ? unsplash(IDS[name], w) : '')
