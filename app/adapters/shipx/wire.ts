import { z } from 'zod';

import {
  SHIPX_COURIER_PARCEL_WEIGHT_KG,
  SHIPX_PARCEL_DIMENSIONS_MM,
  splitPersonName,
  normalizeShipxPhone,
  type ShipxRemoteShipment,
  type ShipxShipmentRequest,
} from '#core/domain/index.js';

const SHIPX_COUNTRY_CODE = 'PL';

const idSchema = z.union([z.string().min(1), z.number().int()]).transform(String);

const wireOfferSchema = z.object({
  id: idSchema,
  status: z.string().nullish(),
  service: z.object({ id: z.string() }).passthrough().nullish(),
  unavailability_reasons: z.array(z.unknown()).nullish(),
}).passthrough();

export const wireShipmentSchema = z.object({
  id: idSchema,
  status: z.string().min(1).nullish(),
  tracking_number: z.string().min(1).nullish(),
  reference: z.string().nullish(),
  offers: z.array(wireOfferSchema).nullish(),
  selected_offer: wireOfferSchema.nullish(),
  transactions: z.array(z.object({ status: z.string().nullish() }).passthrough()).nullish(),
}).passthrough();

export const wireShipmentListSchema = z.object({ items: z.array(z.unknown()) }).passthrough();

export const wireListedAtSchema = z.object({ created_at: z.string() }).passthrough();

const reasonTextSchema = z.union([
  z.string(),
  z.object({ description: z.string() }).passthrough().transform((reason) => reason.description),
  z.object({ message: z.string() }).passthrough().transform((reason) => reason.message),
]);

const reasonTexts = (reasons: readonly unknown[] | null | undefined): string[] =>
  (reasons ?? []).flatMap((reason) => {
    const text = reasonTextSchema.safeParse(reason);
    return text.success ? [text.data] : [];
  });

const toOffer = (offer: z.infer<typeof wireOfferSchema>) => ({
  id: offer.id,
  status: offer.status ?? '',
  service: offer.service?.id ?? null,
  unavailabilityReasons: reasonTexts(offer.unavailability_reasons),
});

export const toRemoteShipment = (wire: z.infer<typeof wireShipmentSchema>): ShipxRemoteShipment => ({
  id: wire.id,
  status: wire.status ?? 'unknown',
  trackingNumber: wire.tracking_number ?? null,
  reference: wire.reference ?? null,
  offers: (wire.offers ?? []).map(toOffer),
  selectedOffer: wire.selected_offer == null ? null : toOffer(wire.selected_offer),
  transactions: (wire.transactions ?? []).map((transaction) => ({ status: transaction.status ?? '' })),
});

const parcelsFor = (request: ShipxShipmentRequest) => {
  if (request.service === 'inpost_locker_standard') return [{ template: request.parcelTemplate }];
  const dimensions = SHIPX_PARCEL_DIMENSIONS_MM[request.parcelTemplate];
  return [{
    dimensions: {
      length: String(dimensions.length),
      width: String(dimensions.width),
      height: String(dimensions.height),
      unit: 'mm',
    },
    weight: { amount: String(SHIPX_COURIER_PARCEL_WEIGHT_KG), unit: 'kg' },
    is_non_standard: false,
  }];
};

export const toWireShipmentRequest = (request: ShipxShipmentRequest) => {
  const sender = splitPersonName(request.sender.name);
  return {
    sender: {
      ...(request.sender.company === null ? {} : { company_name: request.sender.company }),
      first_name: sender.firstName,
      last_name: sender.lastName,
      email: request.sender.email,
      phone: normalizeShipxPhone(request.sender.phone) ?? request.sender.phone,
      address: {
        street: request.sender.street,
        building_number: request.sender.buildingNumber,
        city: request.sender.city,
        post_code: request.sender.postCode,
        country_code: SHIPX_COUNTRY_CODE,
      },
    },
    receiver: {
      first_name: request.receiver.firstName,
      last_name: request.receiver.lastName,
      email: request.receiver.email,
      phone: request.receiver.phone,
      ...(request.receiver.address === null ? {} : {
        address: {
          street: request.receiver.address.street,
          building_number: request.receiver.address.buildingNumber,
          city: request.receiver.address.city,
          post_code: request.receiver.address.postCode,
          country_code: request.receiver.address.countryCode,
        },
      }),
    },
    parcels: parcelsFor(request),
    ...(request.targetPoint === null ? {} : { custom_attributes: { target_point: request.targetPoint } }),
    service: request.service,
    additional_services: [],
    reference: request.reference,
  };
};
