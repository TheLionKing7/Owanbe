import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Cpu,
  Flower2,
  Handshake,
  Landmark,
  Music,
  Shirt,
  ShieldCheck,
  Star,
  Store,
  Users,
  UtensilsCrossed,
} from "lucide-react";

/**
 * Homepage content. Vendor entries are design placeholders taken from the approved
 * mockup until the discovery feature serves real listings.
 */

export interface MenuLink {
  label: string;
  to: string;
}

export interface NavMenu {
  label: string;
  links: MenuLink[];
}

export const NAV_MENUS: NavMenu[] = [
  {
    label: "Plan",
    links: [
      { label: "AI Event Planner", to: "/host/plan" },
      { label: "My Events", to: "/host/events" },
      { label: "Guest List & RSVPs", to: "/host/guests" },
      { label: "Quotes & Payments", to: "/host/quotes" },
    ],
  },
  {
    label: "Discover",
    links: [
      { label: "Yoruba Weddings", to: "/discover?q=Yoruba%20Wedding" },
      { label: "Birthday Parties", to: "/discover?q=Birthday%20Party" },
      { label: "Naming Ceremonies", to: "/discover?q=Naming%20Ceremony" },
      { label: "Corporate Events", to: "/discover?q=Corporate%20Event" },
    ],
  },
  {
    label: "Vendors",
    links: [
      { label: "Browse Vendors", to: "/discover" },
      { label: "Become a Vendor", to: "/vendor" },
      { label: "Vendor House", to: "/vendor" },
    ],
  },
  {
    label: "Culture",
    links: [
      { label: "Ówàńbè Traditions", to: "/culture" },
      { label: "Aso-Ebi Guide", to: "/culture" },
      { label: "Ceremony Etiquette", to: "/culture" },
    ],
  },
  {
    label: "More",
    links: [
      { label: "About Ówàńbè", to: "/about" },
      { label: "Help Centre", to: "/help" },
      { label: "Trust & Safety", to: "/help" },
    ],
  },
];

export const POPULAR_SEARCHES = ["Yoruba Wedding", "Birthday Party", "Naming Ceremony", "Corporate Event"];

export interface Feature {
  title: string;
  description: string;
  icon: LucideIcon;
}

export const FEATURES: Feature[] = [
  { title: "AI Event Planner", description: "Turn your ideas into a perfect plan", icon: Cpu },
  { title: "Trusted Vendors", description: "Discover verified professionals", icon: Store },
  { title: "Smart Outsourcing", description: "Let us handle the details", icon: Handshake },
  { title: "Secure Transactions", description: "Book with confidence", icon: ShieldCheck },
  { title: "Cultural Intelligence", description: "Celebrate with authenticity", icon: Users },
  { title: "Unforgettable Moments", description: "Create lasting memories", icon: Star },
];

export interface Category {
  label: string;
  slug: string;
  icon: LucideIcon;
  color: string; // tailwind bg class
}

export const CATEGORIES: Category[] = [
  { label: "Venues", slug: "venues", icon: Landmark, color: "bg-cat-venues" },
  { label: "Catering", slug: "catering", icon: UtensilsCrossed, color: "bg-cat-catering" },
  { label: "Decoration", slug: "decoration", icon: Flower2, color: "bg-cat-decoration" },
  { label: "Photography & Videography", slug: "photography", icon: Camera, color: "bg-cat-photo" },
  { label: "Fashion & Attire", slug: "fashion", icon: Shirt, color: "bg-cat-fashion" },
  { label: "Music & Entertainment", slug: "music", icon: Music, color: "bg-cat-music" },
];

export interface Vendor {
  id: string;
  name: string;
  rating: number;
  reviews: string;
  location: string;
  badge: string;
  image: string;
  imageAlt: string;
}

export const FEATURED_VENDORS: Vendor[] = [
  {
    id: "royal-events-place",
    name: "Royal Events Place",
    rating: 4.8,
    reviews: "1.2k",
    location: "Lekki, Lagos",
    badge: "Top Rated",
    image: "/images/vendor-1.webp",
    imageAlt: "Banquet hall dressed with purple linens and tall floral centrepieces",
  },
  {
    id: "delightful-bites",
    name: "Delightful Bites",
    rating: 4.7,
    reviews: "856",
    location: "Victoria Island, Lagos",
    badge: "Trusted Vendor",
    image: "/images/vendor-2.webp",
    imageAlt: "Buffet table of silver chafing dishes surrounded by flowers",
  },
  {
    id: "elegance-decor",
    name: "Elegance Decor",
    rating: 4.9,
    reviews: "723",
    location: "Ikeja, Lagos",
    badge: "Premium",
    image: "/images/vendor-3.webp",
    imageAlt: "Reception tables with abundant pink, red and gold floral arrangements",
  },
];
