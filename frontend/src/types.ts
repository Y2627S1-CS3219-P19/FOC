export type Role = 'user' | 'admin';

export interface Profile {
  id: string;
  username: string;
  email: string;
  displayName: string;
  contactNumber: string | null;
  defaultDeliveryLocation: string | null;
  role: Role;
  status: 'active' | 'suspended';
  rating: number | null;
  roles?: Role[];
  suspension?: { reason: string | null; since: string | null; adminContact: string } | null;
}

export interface AdminUser extends Profile {
  suspensionReason: string | null;
  suspendedAt: string | null;
}

export interface RoleChange {
  id: string;
  targetUserId: string;
  targetUsername?: string;
  fromRole: Role;
  toRole: Role;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedByUsername?: string;
  decidedBy: string | null;
  decidedByUsername: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  facilityType: string;
  building: string;
  floor: string | null;
  locationDescription: string;
  latitude: number | null;
  longitude: number | null;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  isOpenNow: boolean;
  imageUrl: string | null;
}

export type SupplierInput = Pick<Supplier, 'name' | 'facilityType' | 'building' | 'locationDescription' | 'opensAt' | 'closesAt'> & {
  floor: string | null;
};

/** One row of the user-service admin audit log. adminId is null for the system (e.g. BOOTSTRAP_ADMIN). */
export interface AuditEntry {
  id: string;
  adminId: string | null;
  adminUsername: string | null;
  counterpartAdminId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}
