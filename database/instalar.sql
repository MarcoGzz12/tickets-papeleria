-- =====================================================================
-- TICKETS DE TRABAJO — PAPELERÍA
-- Pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- RESPONSABLES (se administran desde Ajustes en la app)
-- ---------------------------------------------------------------------
create table if not exists public.responsables (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) > 0),
  color      text not null default '#2563eb',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TICKETS
-- ---------------------------------------------------------------------
create table if not exists public.tickets (
  id             uuid primary key default gen_random_uuid(),
  folio          bigint generated always as identity,
  cliente        text not null check (length(trim(cliente)) > 0),
  telefono       text,
  trabajo        text not null check (length(trim(trabajo)) > 0),   -- título corto: "100 tarjetas de presentación"
  instrucciones  text not null default '',                          -- qué se tiene que hacer, a detalle
  fotos          text[] not null default '{}',                      -- rutas dentro del bucket tickets-fotos
  fecha_inicio   date not null default current_date,
  fecha_entrega  date not null,
  responsable_id uuid references public.responsables(id) on delete set null,
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'en_proceso', 'listo', 'entregado')),
  prioridad      text not null default 'normal'
                 check (prioridad in ('normal', 'urgente')),
  creado_por     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fechas_en_orden check (fecha_entrega >= fecha_inicio)
);

create index if not exists tickets_estado_idx  on public.tickets (estado);
create index if not exists tickets_entrega_idx on public.tickets (fecha_entrega);

create or replace function public.tickets_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.tickets_touch();

-- ---------------------------------------------------------------------
-- SEGURIDAD: solo usuarios con sesión iniciada ven y editan
-- ---------------------------------------------------------------------
alter table public.responsables enable row level security;
alter table public.tickets      enable row level security;

drop policy if exists "equipo_responsables" on public.responsables;
create policy "equipo_responsables" on public.responsables
  for all to authenticated using (true) with check (true);

drop policy if exists "equipo_tickets" on public.tickets;
create policy "equipo_tickets" on public.tickets
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- FOTOS: bucket privado (se ven con enlaces temporales)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets-fotos', 'tickets-fotos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists "equipo_fotos_leer"   on storage.objects;
drop policy if exists "equipo_fotos_subir"  on storage.objects;
drop policy if exists "equipo_fotos_borrar" on storage.objects;

create policy "equipo_fotos_leer" on storage.objects
  for select to authenticated using (bucket_id = 'tickets-fotos');
create policy "equipo_fotos_subir" on storage.objects
  for insert to authenticated with check (bucket_id = 'tickets-fotos');
create policy "equipo_fotos_borrar" on storage.objects
  for delete to authenticated using (bucket_id = 'tickets-fotos');

-- ---------------------------------------------------------------------
-- TIEMPO REAL: el tablero se actualiza solo en todas las pantallas
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.tickets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.responsables;
  exception when duplicate_object then null;
  end;
end $$;
