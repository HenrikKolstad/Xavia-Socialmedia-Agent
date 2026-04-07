export interface Property {
  id: string;           // XE-prefixed ID e.g. "XE51497E"
  title: string;        // e.g. "Villa in Mutxamel, Alicante"
  price: number;        // in euros
  priceFormatted: string;
  location: string;
  bedrooms: number;
  bathrooms: number;
  sizeInterior: number; // m²
  sizePlot: number | null;
  propertyType: string; // villa, apartment, penthouse, etc.
  url: string;          // full URL to property page
  imageUrls: string[];  // property image URLs
  scrapedAt: string;    // ISO timestamp
}

export interface PostRecord {
  propertyId: string;
  postedToInstagram: boolean;
  postedToTikTok: boolean;
  postedToReels?: boolean;
  instagramPostId?: string;
  tiktokPostId?: string;
  reelPostId?: string;
  postedAt: string;
  caption: string;
}

export interface PostedData {
  posts: PostRecord[];
}
