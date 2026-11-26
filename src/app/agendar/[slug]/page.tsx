import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BookingWizard } from "@/components/booking-wizard";
import { loadPromoRules } from "@/lib/promo-load";
import { withTenantContext } from "@/lib/tenant-context";
import { PUBLIC_BOOKING_MAX_DAYS, publicBookingRange } from "@/lib/booking-availability";

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: {
      services: { where: { active: true }, orderBy: { name: "asc" } },
      professionals: {
        where: { active: true, generateAgenda: true },
        orderBy: { name: "asc" },
        include: { serviceLinks: true },
      },
    },
  });
  if (!tenant) notFound();

  const horizon = publicBookingRange(undefined, PUBLIC_BOOKING_MAX_DAYS);

  const [promotions, busyAppointments, busyBlocks] = await withTenantContext(tenant.id, () =>
    Promise.all([
      loadPromoRules(tenant.id),
      prisma.appointment.findMany({
        where: {
          tenantId: tenant.id,
          status: { notIn: ["CANCELLED"] },
          startAt: { lt: horizon.end },
          endAt: { gt: horizon.start },
        },
        select: { professionalId: true, startAt: true, endAt: true },
      }),
      prisma.scheduleBlock.findMany({
        where: {
          tenantId: tenant.id,
          startAt: { lt: horizon.end },
          endAt: { gt: horizon.start },
        },
        select: { professionalId: true, startAt: true, endAt: true },
      }),
    ]),
  );
  const busy = [...busyAppointments, ...busyBlocks];

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-10">
      <p className="text-sm font-medium text-ink-soft">Agendamento online</p>
      <h1 className="font-display text-4xl">{tenant.name}</h1>
      <p className="mt-2 text-ink-soft">{tenant.city ?? "Escolha serviço, profissional e horário."}</p>
      <div className="mt-8">
        <BookingWizard
          slug={tenant.slug}
          salon={tenant.name}
          openTime={tenant.openTime}
          closeTime={tenant.closeTime}
          slotMinutes={tenant.slotMinutes}
          today={horizon.today}
          maxDays={PUBLIC_BOOKING_MAX_DAYS}
          promotions={promotions}
          services={tenant.services}
          professionals={tenant.professionals.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            workStart: p.workStart,
            workEnd: p.workEnd,
            serviceIds: p.serviceLinks.map((l) => l.serviceId),
          }))}
          busy={busy.map((b) => ({
            professionalId: b.professionalId,
            startAt: b.startAt.toISOString(),
            endAt: b.endAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}
