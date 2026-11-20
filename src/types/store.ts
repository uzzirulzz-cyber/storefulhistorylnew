export type ProductCategory =
  | 'PC Games'
  | 'Console Subscriptions'
  | 'Gift Cards'
  | 'Software Keys'
  | 'Security & VPN';

export type ProductPlatform =
  | 'Steam'
  | 'Xbox'
  | 'PlayStation'
  | 'PC'
  | 'Nintendo'
  | 'Windows / Office'
  | 'Multi-Device'
  | 'Business Service'
  | 'Playbeat TV';

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export type StorefrontSection = 'section1-digital' | 'section2-services' | 'section3-livetv';

export interface Product {
  sku: string;
  publicCode?: string;
  name: string;
  category: ProductCategory;
  platform: ProductPlatform;
  region: string;
  originalPriceUsd: number;
  priceUsd: number;
  pricePkr: number;
  discountPercent: number;
  stockCount: number;
  stockStatus: StockStatus;
  deliveryType: 'Instant Digital Key';
  /** Strictly admin-only supplier URL — never rendered to buyers */
  productUrl: string;
  imageUrl: string;
  description: string;
  activationGuide: string;
  featured?: boolean;
  published?: boolean;
  affiliatePartner?: boolean;
  /** Set only after a product has been validated from the authenticated supplier feed. */
  supplierVerified?: boolean;
}

export type ServiceCategory =
  | 'Business Websites'
  | 'E-Commerce'
  | 'CRM & Operations'
  | 'Lead Generation'
  | 'Real Estate'
  | 'Education'
  | 'FinTech / Dashboards'
  | 'Admin Systems'
  | 'Automation'
  | 'Custom Development';

export type ServicePackageLevel = 'Basic' | 'Professional' | 'Enterprise';

export interface BusinessService {
  id: string;
  sku: string;
  category: ServiceCategory;
  name: string;
  shortDescription: string;
  recommendedPkr: number;
  optionalUsd: number;
  isStartingFrom?: boolean;
  packageLevel: ServicePackageLevel;
  deliveryTime: string;
  deliverables: string[];
  featured?: boolean;
  published: boolean;
  quantifiedOutcome?: string;
  imageUrl?: string;
}

export interface ServiceInquiry {
  id: string;
  serviceId: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string;
  notes: string;
  status: 'NEW' | 'CONTACTED' | 'QUOTED' | 'WON';
  createdAt: string;
}

export type TvChannelCategory =
  | 'News'
  | 'Sports'
  | 'Entertainment'
  | 'Movies'
  | 'Documentary'
  | 'Kids'
  | 'Regional & World';

export interface LiveTvChannel {
  id: string;
  name: string;
  category: TvChannelCategory;
  country: string;
  language: string;
  quality: '4K UHD' | '1080p HD' | '720p HD';
  streamType: 'Public FTA' | 'HLS Live' | 'Playbeat Fast';
  streamUrl: string;
  imageUrl?: string;
  nowPlaying?: string;
  upNext?: string;
  tagline: string;
  isLive: boolean;
  published: boolean;
}

export interface LiveTvPlan {
  id: string;
  sku: string;
  name: string;
  lineType: 'Xtream Line' | 'ActiveCode (APK / ISO)' | 'Multi-Screen Family';
  durationLabel: string;
  priceUsd: number;
  pricePkr: number;
  originalPriceUsd: number;
  channelsCount: string;
  vodLibrary: string;
  connections: number;
  features: string[];
  featured?: boolean;
  published: boolean;
}

export interface CartItem {
  sku: string;
  quantity: number;
  section?: StorefrontSection;
}

export type PaymentRail = 'rapid' | 'paypal' | 'manual';

export type ManualChannel =
  | 'Bank Transfer (IBAN)'
  | 'JazzCash Manual'
  | 'Easypaisa Manual'
  | 'Crypto (USDT)';

export type OrderStatus =
  | 'PENDING_VERIFICATION'
  | 'AWAITING_PAYMENT'
  | 'PROCESSING'
  | 'PAID_FULFILLED'
  | 'FAILED'
  | 'EXPIRED';

export interface IssuedKey {
  sku: string;
  productName: string;
  platform: ProductPlatform;
  keyCode: string;
  source: 'Playbeat Digital Inventory' | 'ElectronicFirst Partner API' | 'Playbeat Fulfillment';
}

export interface OrderRecord {
  orderId: string;
  createdAt: string;
  updatedAt: string;
  customerEmail: string;
  customerMobile: string;
  paymentRail: PaymentRail;
  manualChannel?: ManualChannel;
  manualReference?: string;
  manualSenderAccount?: string;
  currency: 'USD' | 'PKR';
  totalUsd: number;
  totalPkr: number;
  status: OrderStatus;
  statusDetail: string;
  items: Array<{
    sku: string;
    name: string;
    platform: ProductPlatform;
    quantity: number;
    unitPriceUsd: number;
    unitPricePkr: number;
  }>;
  paypalOrderId?: string;
  paypalApprovalUrl?: string;
  rapidSessionId?: string;
  rapidEnvironment?: 'TEST' | 'LIVE';
  rapidTestScenario?: string;
  issuedKeys: IssuedKey[];
}

export interface ElectronicFirstSyncResult {
  syncedAt: string;
  source: 'live_api' | 'catalog_snapshot' | 'unavailable';
  apiConfigured: boolean;
  httpStatus: number | null;
  message: string;
  productCount: number;
  balanceInfo?: string | null;
}

export interface PublicStoreConfig {
  storeName: string;
  pkrPerUsd: number;
  defaultRail: PaymentRail;
  paypal: {
    enabled: boolean;
    clientId: string;
    environment: 'sandbox' | 'live';
  };
  rapid: {
    enabled: boolean;
    merchantId: string;
    environment: 'TEST' | 'LIVE';
    sdkUrl: string;
  };
  electronicFirst?: {
    configured: boolean;
  };
}

export interface IntegrationReadiness {
  usdToPkrRate: number;
  electronicFirst: {
    configured: boolean;
    baseUrl: string;
    endpoints: string[];
  };
  paypal: {
    configured: boolean;
    environment: 'sandbox' | 'live';
    baseUrl: string;
  };
  rapidGateway: {
    configured: boolean;
    merchantId: string;
    environment: 'TEST' | 'LIVE';
    baseUrl: string;
    signingSaltConfigured: boolean;
  };
}
