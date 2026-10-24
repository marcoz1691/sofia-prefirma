-- Esquema del asistente de WhatsApp de la Notaría 41.
-- Ejecutar en el editor SQL de Supabase. Solo el servidor (clave service_role) accede a estas tablas:
-- RLS activado y sin políticas = nadie más puede leer ni escribir (ni con la clave anon).

create table if not exists conversaciones (
  id uuid primary key default gen_random_uuid(),
  telefono text not null unique,
  nombre text not null default '',
  consentimiento boolean not null default false,
  consentimiento_en timestamptz,
  derivada boolean not null default false,
  cliente_en_ms bigint not null default 0,          -- último mensaje escrito por el cliente (ventana de 24 h)
  turno_hasta_ms bigint not null default 0,         -- turno de respuesta tomado hasta este momento (0 = libre)
  ultimo_texto text not null default '',            -- para la lista del panel
  ultima_actividad_ms bigint not null default 0,
  creada timestamptz not null default now()
);

create table if not exists sesiones (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  sistema text not null,                             -- prompt de sistema congelado para toda la sesión
  ultima_ms bigint not null,
  creada timestamptz not null default now()
);
create index if not exists sesiones_conversacion on sesiones(conversacion_id, creada);

create table if not exists mensajes (
  id bigserial primary key,
  sesion_id uuid not null references sesiones(id) on delete cascade,
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  rol text not null check (rol in ('user', 'assistant', 'system')),
  contenido jsonb not null,                          -- mensaje tal como lo recibe/devuelve la API de Claude (sin editar)
  creado timestamptz not null default now()
);
create index if not exists mensajes_sesion on mensajes(sesion_id, id);

create table if not exists procesados (
  wa_id text primary key,                            -- id de mensaje de WhatsApp: evita atenderlo dos veces
  creado timestamptz not null default now()
);

-- Mensajes del cliente que esperan su turno (se agrupan burbujas seguidas en un solo turno).
create table if not exists pendientes (
  id bigserial primary key,
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  mensaje jsonb not null,
  creado timestamptz not null default now()
);
create index if not exists pendientes_conversacion on pendientes(conversacion_id, id);

create table if not exists archivos (
  id text not null,                                  -- media_id de WhatsApp
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  mime text not null default '',
  nombre text not null default '',
  creado timestamptz not null default now(),
  primary key (conversacion_id, id)
);

create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  media_id text not null,
  nombre text not null default '',
  mime text not null default '',
  ruta text not null,                                -- ruta en el bucket privado "documentos"
  descripcion text not null default '',
  tramite_id text,
  estado text not null default 'recibido' check (estado in ('recibido', 'aprobado', 'observado')),  -- pre-revisión del personal
  nota text not null default '',
  -- Seguridad del objeto, independiente de la revisión notarial. Los nuevos objetos nacen aislados.
  seguridad_estado text not null default 'cuarentena' check (seguridad_estado in ('cuarentena', 'limpio', 'bloqueado', 'error')),
  seguridad_motivo text not null default '',
  seguridad_revisado_en timestamptz,
  creado timestamptz not null default now()
);
create index if not exists documentos_conversacion on documentos(conversacion_id);

create table if not exists solicitudes_cita (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  tramite_id text,
  fecha date not null,
  hora text not null,
  nombre text not null,
  nota text not null default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'rechazada', 'atendida')),
  motivo text not null default '',
  recordada boolean not null default false,
  creada timestamptz not null default now()
);
alter table solicitudes_cita add column if not exists asignada_a text not null default '';
create index if not exists citas_conversacion on solicitudes_cita(conversacion_id);
create index if not exists citas_fecha on solicitudes_cita(fecha, estado);
create index if not exists mensajes_conversacion on mensajes(conversacion_id, id);
create index if not exists conversaciones_actividad on conversaciones(ultima_actividad_ms desc);

-- Personas autorizadas a entrar al panel (por correo de su cuenta de Supabase Auth).
create table if not exists personal (
  email text primary key,
  nombre text not null default ''
);

alter table conversaciones enable row level security;
alter table sesiones enable row level security;
alter table mensajes enable row level security;
alter table procesados enable row level security;
alter table pendientes enable row level security;
alter table archivos enable row level security;
alter table documentos enable row level security;
alter table solicitudes_cita enable row level security;
alter table personal enable row level security;

-- Bucket privado para los documentos de los clientes.
insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- Chat web: celular de contacto en las citas y contador de uso para limitar costos.
alter table solicitudes_cita add column if not exists contacto text;

create table if not exists uso (
  clave text not null,
  ventana bigint not null,
  cuenta int not null default 0,
  primary key (clave, ventana)
);
alter table uso enable row level security;

create or replace function incrementar_uso(p_clave text, p_ventana bigint) returns int
language sql as $$
  insert into uso (clave, ventana, cuenta) values (p_clave, p_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = uso.cuenta + 1
  returning cuenta;
$$;
revoke execute on function incrementar_uso(text, bigint) from public, anon, authenticated;

-- Seguridad (oct. 2026) ------------------------------------------------------------------------------------------

-- Evidencia del consentimiento (Reglamento LOPDP, art. 5): lo que escribió el cliente y la versión del aviso aceptado.
alter table conversaciones add column if not exists consentimiento_texto text not null default '';
alter table conversaciones add column if not exists consentimiento_aviso text not null default '';

-- Borrado recuperable de documentos: el panel los marca y la purga diaria elimina el archivo días después.
alter table documentos add column if not exists borrado_en timestamptz;
alter table documentos add column if not exists borrado_por text not null default '';
create index if not exists documentos_borrados on documentos(borrado_en) where borrado_en is not null;

-- Auditoría del panel: quién vio o cambió qué. Solo se agrega; no se puede editar ni borrar.
create table if not exists auditoria (
  id bigserial primary key,
  creado timestamptz not null default now(),
  email text not null default '',
  accion text not null,
  objetivo text not null default '',
  ok boolean not null default true
);
create index if not exists auditoria_creado on auditoria(creado desc);
alter table auditoria enable row level security;

create or replace function auditoria_inmutable() returns trigger language plpgsql as $$
begin
  raise exception 'La auditoría no se puede modificar ni borrar';
end $$;
drop trigger if exists auditoria_inmutable on auditoria;
create trigger auditoria_inmutable before update or delete on auditoria for each row execute function auditoria_inmutable();

-- La purga busca conversaciones inactivas.
create index if not exists conversaciones_creada on conversaciones(creada);

-- Primera vez que cada persona del personal entra con la verificación en dos pasos (para avisar al administrador).
alter table personal add column if not exists mfa_en timestamptz;

-- 2026-10-07: precios y ajustes editables por administradores.
create table if not exists precios (
  tramite_id text primary key,
  tipo text not null check (tipo in ('pct','fija','cuantia','consultar')),
  valor numeric,
  unidad text not null default '',
  tabla text not null default '',
  actualizado_por text not null default '',
  actualizado_en timestamptz not null default now()
);
create table if not exists ajustes (clave text primary key, valor text not null, actualizado_por text not null default '', actualizado_en timestamptz not null default now());
alter table personal add column if not exists rol text not null default 'personal' check (rol in ('admin','personal'));
alter table precios enable row level security;
alter table ajustes enable row level security;
-- Los contadores de uso guardan celulares y huellas de IP: se purgan a los 7 días.
alter table uso add column if not exists creado timestamptz not null default now();
create index if not exists uso_creado on uso(creado);

-- 2026-10-07: ticket de cuatro dígitos, único por día; las citas anteriores conservan null.
alter table solicitudes_cita add column if not exists codigo text check (codigo ~ '^[1-9][0-9]{3}$');
create unique index if not exists solicitudes_cita_fecha_codigo on solicitudes_cita(fecha, codigo);

-- Un precio de tipo porcentaje o fijo siempre lleva un valor positivo (la validación del panel no es la única defensa).
alter table precios drop constraint if exists precios_valor_valido;
alter table precios add constraint precios_valor_valido check (tipo not in ('pct','fija') or (valor is not null and valor > 0));

-- 2026-10-11: métricas agregadas del piloto. Ejecuta este bloque antes de desplegar.
create table if not exists metricas_dia (fecha date not null, clave text not null, valor bigint not null default 0, primary key (fecha, clave));
alter table metricas_dia enable row level security;
create or replace function sumar_metrica(p_fecha date, p_clave text, p_valor bigint) returns void language sql security definer set search_path = public as $$
  insert into metricas_dia (fecha, clave, valor) values (p_fecha, p_clave, p_valor)
  on conflict (fecha, clave) do update set valor = metricas_dia.valor + excluded.valor;
$$;
revoke execute on function sumar_metrica(date, text, bigint) from public, anon, authenticated;
grant execute on function sumar_metrica(date, text, bigint) to service_role;

-- 2026-10-11: perfil notario.
alter table personal drop constraint if exists personal_rol_check;
alter table personal add constraint personal_rol_check check (rol in ('admin','notario','personal'));
alter table personal add column if not exists creado timestamptz not null default now();

-- 2026-10-16: historial de consentimientos (LOPDP art. 8; Reglamento art. 5). Evidencia de cuándo, por qué canal y qué
-- versión del aviso de privacidad y de los términos aceptó cada persona. Se conserva hasta 5 años, aunque el chat se borre.
create table if not exists consentimientos (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  canal text not null check (canal in ('formulario', 'chat-web', 'whatsapp', 'documentos')),
  titular text not null,              -- huella (hash) del celular o de la sesión; nunca el dato en claro
  aviso text not null,                -- versión del aviso de privacidad aceptada
  terminos text not null default '',  -- versión de los términos aceptada ('' si el canal no los pide)
  texto text not null default ''      -- lo que marcó o escribió la persona
);
create index if not exists consentimientos_titular on consentimientos (titular);
alter table consentimientos enable row level security;
-- Sin políticas públicas: acceso únicamente desde el servidor con service role.

-- 2026-10-18: cuentas de cliente y portal «Mis trámites» (Sofía PreFirma). Ver docs/adr/0004 y docs/multi-notaria.md.
-- Orden: notarías, notaria_id en tablas existentes, clientes, códigos, sesiones, vínculos de trámites, eventos, pagos.
-- Los clientes NO son usuarios de Supabase Auth: el servidor emite sus sesiones. Todo acceso es por service_role.
create table if not exists notarias (
  id text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  nombre text not null,
  creado timestamptz not null default now()
);
insert into notarias (id, nombre) values ('notaria41', 'Notaría 41 de Quito') on conflict (id) do nothing;
alter table conversaciones add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table solicitudes_cita add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table personal add column if not exists notaria_id text not null default 'notaria41' references notarias(id);

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  email_verificado_en timestamptz not null,
  nombres text not null default '' check (length(nombres) <= 80),
  apellidos text not null default '' check (length(apellidos) <= 80),
  celular text check (celular ~ '^5939[0-9]{8}$'),
  avisos_correo boolean not null default true,
  avisos_whatsapp boolean not null default false,
  privacidad_version text not null default '',
  terminos_version text not null default '',
  privacidad_aceptada_en timestamptz,
  estado text not null default 'activa' check (estado in ('activa', 'bloqueada')),
  creado timestamptz not null default now(),
  ultimo_acceso timestamptz not null default now(),
  unique (notaria_id, email)
);

-- Códigos de un solo uso: se guarda la huella del correo y el HMAC del código, nunca el correo ni el código en claro.
create table if not exists cliente_codigos (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  destino_huella text not null,
  codigo_hmac text not null,
  intentos int not null default 0 check (intentos between 0 and 10),
  expira_en timestamptz not null,
  usado_en timestamptz,
  ip_huella text not null default '',
  creado timestamptz not null default now()
);
create index if not exists cliente_codigos_destino on cliente_codigos (notaria_id, destino_huella, creado desc);

-- Sesiones del cliente: solo la huella sha256 del token de la cookie.
create table if not exists cliente_sesiones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  notaria_id text not null references notarias(id),
  token_hash text not null unique,
  creada timestamptz not null default now(),
  ultima_actividad timestamptz not null default now(),
  expira_en timestamptz not null,
  revocada_en timestamptz
);
create index if not exists cliente_sesiones_cliente on cliente_sesiones (cliente_id);

alter table solicitudes_cita add column if not exists cliente_id uuid references clientes(id) on delete set null;
create index if not exists solicitudes_cita_cliente on solicitudes_cita (notaria_id, cliente_id);
create index if not exists solicitudes_cita_codigo on solicitudes_cita (notaria_id, codigo);
alter table documentos add column if not exists solicitud_id uuid references solicitudes_cita(id) on delete set null;
-- La observación la ve el cliente; la «nota» existente es interna y nunca sale del panel.
alter table documentos add column if not exists observacion_cliente text not null default '' check (length(observacion_cliente) <= 500);

-- Enlaces para guardar un trámite en una cuenta: token aleatorio de un solo uso; se guarda solo su huella.
create table if not exists tramite_vinculaciones (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  solicitud_id uuid not null references solicitudes_cita(id) on delete cascade,
  token_hash text not null unique,
  canal text not null check (canal in ('creacion', 'whatsapp', 'panel')),
  expira_en timestamptz not null,
  usado_en timestamptz,
  usado_por uuid references clientes(id) on delete set null,
  creado_por text not null default 'sistema',
  creado timestamptz not null default now()
);
create index if not exists tramite_vinculaciones_vigentes on tramite_vinculaciones (solicitud_id) where usado_en is null;

create table if not exists tramite_eventos (
  id bigint generated always as identity primary key,
  notaria_id text not null references notarias(id),
  solicitud_id uuid not null references solicitudes_cita(id) on delete cascade,
  tipo text not null check (tipo in ('creada', 'confirmada', 'rechazada', 'atendida', 'documento_recibido', 'documento_aprobado',
    'documento_observado', 'vinculada', 'desvinculada', 'pago_pendiente', 'pago_pagado', 'pago_fallido', 'pago_cancelado', 'pago_reembolsado')),
  visible_cliente boolean not null default true,
  texto_cliente text not null default '' check (length(texto_cliente) <= 300),
  actor text not null check (actor in ('sistema', 'personal', 'cliente')),
  creado timestamptz not null default now()
);
create index if not exists tramite_eventos_solicitud on tramite_eventos (solicitud_id, creado);

-- Pagos del ciudadano por un trámite (caso A). El pago de la notaría por su plan (caso B) irá en otras tablas.
create table if not exists pagos (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  solicitud_id uuid references solicitudes_cita(id) on delete set null,
  cliente_id uuid references clientes(id) on delete set null,
  ticket_snapshot text not null default '',
  concepto text not null check (length(concepto) between 1 and 200),
  monto_centavos int not null check (monto_centavos > 0),
  moneda text not null default 'USD' check (moneda = 'USD'),
  estado text not null default 'creado' check (estado in ('creado', 'pendiente', 'procesando', 'pagado', 'fallido', 'cancelado', 'reembolsado')),
  proveedor text not null,
  orden_proveedor text,
  idempotencia text not null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  pagado_en timestamptz,
  unique (proveedor, orden_proveedor)
);
create index if not exists pagos_solicitud on pagos (notaria_id, solicitud_id);
-- La idempotencia pertenece a una notaría y dos pedidos simultáneos nunca abren dos cobros para el mismo trámite.
alter table pagos drop constraint if exists pagos_idempotencia_key;
create unique index if not exists pagos_notaria_idempotencia on pagos (notaria_id, idempotencia);
create unique index if not exists pagos_uno_activo_por_solicitud on pagos (solicitud_id)
  where solicitud_id is not null and estado in ('creado', 'pendiente', 'procesando');

create table if not exists pago_eventos (
  id bigint generated always as identity primary key,
  pago_id uuid references pagos(id) on delete set null,
  proveedor text not null,
  evento_proveedor_id text not null,
  tipo text not null default '',
  estado_anterior text,
  estado_nuevo text,
  monto_centavos int,
  moneda text,
  firma_valida boolean not null,
  resultado text not null check (resultado in ('aplicado', 'duplicado', 'ignorado_orden', 'discrepancia', 'firma_invalida')),
  carga_huella text not null default '',   -- sha256 del cuerpo recibido; el cuerpo crudo no se guarda
  creado timestamptz not null default now(),
  unique (proveedor, evento_proveedor_id)
);
create or replace function pago_eventos_inmutable() returns trigger language plpgsql as $$
begin raise exception 'pago_eventos es de solo agregar'; end $$;
drop trigger if exists pago_eventos_inmutable on pago_eventos;
create trigger pago_eventos_inmutable before update or delete on pago_eventos for each row execute function pago_eventos_inmutable();

alter table consentimientos drop constraint if exists consentimientos_canal_check;
alter table consentimientos add constraint consentimientos_canal_check check (canal in ('formulario', 'chat-web', 'whatsapp', 'documentos', 'portal'));

-- Consumo atómico de un código: acierto, fallo (suma un intento y lo anula al quinto) o inexistente.
create or replace function consumir_codigo_cliente(p_notaria text, p_destino text, p_hmac text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hmac text;
begin
  select id, codigo_hmac into v_id, v_hmac from cliente_codigos
    where notaria_id = p_notaria and destino_huella = p_destino and usado_en is null and expira_en > now() and intentos < 5
    order by creado desc limit 1 for update;
  if v_id is null then return false; end if;
  if v_hmac = p_hmac then update cliente_codigos set usado_en = now() where id = v_id; return true; end if;
  update cliente_codigos set intentos = intentos + 1, usado_en = case when intentos + 1 >= 5 then now() else null end where id = v_id;
  return false;
end $$;

-- Consumo atómico de un enlace de vinculación: se usa una vez y solo vincula trámites sin dueño o del mismo cliente.
create or replace function consumir_vinculacion(p_notaria text, p_token_hash text, p_cliente uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sol uuid;
begin
  update tramite_vinculaciones set usado_en = now(), usado_por = p_cliente
    where notaria_id = p_notaria and token_hash = p_token_hash and usado_en is null and expira_en > now()
    returning solicitud_id into v_sol;
  if v_sol is null then return null; end if;
  update solicitudes_cita set cliente_id = p_cliente
    where id = v_sol and notaria_id = p_notaria and (cliente_id is null or cliente_id = p_cliente);
  if not found then return null; end if;
  return v_sol;
end $$;
revoke execute on function consumir_codigo_cliente(text, text, text) from public, anon, authenticated;
grant execute on function consumir_codigo_cliente(text, text, text) to service_role;
revoke execute on function consumir_vinculacion(text, text, uuid) from public, anon, authenticated;
grant execute on function consumir_vinculacion(text, text, uuid) to service_role;

alter table notarias enable row level security;
alter table clientes enable row level security;
alter table cliente_codigos enable row level security;
alter table cliente_sesiones enable row level security;
alter table tramite_vinculaciones enable row level security;
alter table tramite_eventos enable row level security;
alter table pagos enable row level security;
alter table pago_eventos enable row level security;
revoke all on notarias, clientes, cliente_codigos, cliente_sesiones, tramite_vinculaciones, tramite_eventos, pagos, pago_eventos from anon, authenticated;
-- Sin políticas: el aislamiento por notaría y por cliente lo exige el servidor (cada método del almacén pide notariaId).

-- 2026-10-19: aislamiento del núcleo por notaría.
-- Esta migración amplía el aislamiento del portal al panel, conversaciones, citas, documentos, precios,
-- ajustes, métricas, auditoría, límites de uso y consentimientos. Los datos existentes pertenecen al piloto.

-- Conversaciones y citas: el mismo teléfono y el mismo ticket diario pueden existir en notarías distintas.
alter table conversaciones drop constraint if exists conversaciones_telefono_key;
create unique index if not exists conversaciones_notaria_telefono on conversaciones (notaria_id, telefono);
create unique index if not exists conversaciones_notaria_id_id on conversaciones (notaria_id, id);
drop index if exists solicitudes_cita_fecha_codigo;
create unique index if not exists solicitudes_cita_notaria_fecha_codigo on solicitudes_cita (notaria_id, fecha, codigo);
create unique index if not exists solicitudes_cita_notaria_id_id on solicitudes_cita (notaria_id, id);
alter table solicitudes_cita drop constraint if exists solicitudes_cita_notaria_conversacion_fkey;
alter table solicitudes_cita add constraint solicitudes_cita_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;

-- Historial y cola: además de heredar la conversación, cada fila lleva el tenant para que toda consulta pueda
-- fallar cerrada sin depender de que quien la llama haya validado antes el UUID de la conversación o sesión.
-- Los defaults de `notaria41` se conservan en esta fase expansiva porque el backend institucional anterior comparte
-- la base durante el corte. Se retiran en una migración contractual después de actualizar y verificar ambos despliegues.
alter table sesiones add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create unique index if not exists sesiones_notaria_id_id on sesiones (notaria_id, id);
create index if not exists sesiones_notaria_conversacion on sesiones (notaria_id, conversacion_id, creada);
alter table sesiones drop constraint if exists sesiones_notaria_conversacion_fkey;
alter table sesiones add constraint sesiones_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;

alter table mensajes add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create index if not exists mensajes_notaria_conversacion on mensajes (notaria_id, conversacion_id, id);
alter table mensajes drop constraint if exists mensajes_notaria_conversacion_fkey;
alter table mensajes add constraint mensajes_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;
alter table mensajes drop constraint if exists mensajes_notaria_sesion_fkey;
alter table mensajes add constraint mensajes_notaria_sesion_fkey
  foreign key (notaria_id, sesion_id) references sesiones(notaria_id, id) on delete cascade;

alter table pendientes add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create index if not exists pendientes_notaria_conversacion on pendientes (notaria_id, conversacion_id, id);
alter table pendientes drop constraint if exists pendientes_notaria_conversacion_fkey;
alter table pendientes add constraint pendientes_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;

alter table archivos add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table archivos drop constraint if exists archivos_pkey;
alter table archivos add constraint archivos_pkey primary key (notaria_id, conversacion_id, id);
alter table archivos drop constraint if exists archivos_notaria_conversacion_fkey;
alter table archivos add constraint archivos_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;

-- Documentos: la ruta y toda lectura/escritura quedan acotadas al tenant; la FK impide asociarlos a otra notaría.
alter table documentos add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create index if not exists documentos_notaria_conversacion on documentos (notaria_id, conversacion_id);
alter table documentos drop constraint if exists documentos_notaria_conversacion_fkey;
alter table documentos add constraint documentos_notaria_conversacion_fkey
  foreign key (notaria_id, conversacion_id) references conversaciones(notaria_id, id) on delete cascade;

-- Personal: un correo puede pertenecer a más de una notaría con roles diferentes.
alter table personal drop constraint if exists personal_pkey;
alter table personal add constraint personal_pkey primary key (notaria_id, email);

-- Precios y ajustes dejan de ser globales.
alter table precios add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table precios drop constraint if exists precios_pkey;
alter table precios add constraint precios_pkey primary key (notaria_id, tramite_id);
alter table ajustes add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table ajustes drop constraint if exists ajustes_pkey;
alter table ajustes add constraint ajustes_pkey primary key (notaria_id, clave);

-- Métricas agregadas por tenant; la función exige la notaría explícitamente.
alter table metricas_dia add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table metricas_dia drop constraint if exists metricas_dia_pkey;
alter table metricas_dia add constraint metricas_dia_pkey primary key (notaria_id, fecha, clave);
create or replace function sumar_metrica(p_notaria text, p_fecha date, p_clave text, p_valor bigint) returns void
language sql security definer set search_path = public as $$
  insert into metricas_dia (notaria_id, fecha, clave, valor) values (p_notaria, p_fecha, p_clave, p_valor)
  on conflict (notaria_id, fecha, clave) do update set valor = metricas_dia.valor + excluded.valor;
$$;
revoke execute on function sumar_metrica(text, date, text, bigint) from public, anon, authenticated;
grant execute on function sumar_metrica(text, date, text, bigint) to service_role;
-- Compatibilidad temporal con el backend anterior de la Notaría 41.
create or replace function sumar_metrica(p_fecha date, p_clave text, p_valor bigint) returns void
language sql security definer set search_path = public as $$
  select sumar_metrica('notaria41', p_fecha, p_clave, p_valor);
$$;
revoke execute on function sumar_metrica(date, text, bigint) from public, anon, authenticated;
grant execute on function sumar_metrica(date, text, bigint) to service_role;

-- Contadores, deduplicación, auditoría y consentimientos también pertenecen a una notaría.
alter table uso add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table uso drop constraint if exists uso_pkey;
alter table uso add constraint uso_pkey primary key (notaria_id, clave, ventana);
create or replace function incrementar_uso(p_notaria text, p_clave text, p_ventana bigint) returns int
language sql security definer set search_path = public as $$
  insert into uso (notaria_id, clave, ventana, cuenta) values (p_notaria, p_clave, p_ventana, 1)
  on conflict (notaria_id, clave, ventana) do update set cuenta = uso.cuenta + 1
  returning cuenta;
$$;
revoke execute on function incrementar_uso(text, text, bigint) from public, anon, authenticated;
grant execute on function incrementar_uso(text, text, bigint) to service_role;
-- Compatibilidad temporal con el backend anterior de la Notaría 41.
create or replace function incrementar_uso(p_clave text, p_ventana bigint) returns int
language sql security definer set search_path = public as $$
  select incrementar_uso('notaria41', p_clave, p_ventana);
$$;
revoke execute on function incrementar_uso(text, bigint) from public, anon, authenticated;
grant execute on function incrementar_uso(text, bigint) to service_role;

alter table procesados add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
alter table procesados drop constraint if exists procesados_pkey;
alter table procesados add constraint procesados_pkey primary key (notaria_id, wa_id);
alter table auditoria add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create index if not exists auditoria_notaria_creado on auditoria (notaria_id, creado desc);
alter table consentimientos add column if not exists notaria_id text not null default 'notaria41' references notarias(id);
create index if not exists consentimientos_notaria_titular on consentimientos (notaria_id, titular);

-- 2026-10-19b: elimina las FK simples que quedaron reemplazadas por las compuestas. Mantener ambas hace que
-- PostgREST encuentre dos relaciones posibles para los embeds; las compuestas conservan la misma cascada y además
-- impiden asociar una fila hija con una conversación o sesión de otra notaría.
alter table solicitudes_cita drop constraint if exists solicitudes_cita_conversacion_id_fkey;
alter table sesiones drop constraint if exists sesiones_conversacion_id_fkey;
alter table mensajes drop constraint if exists mensajes_conversacion_id_fkey;
alter table mensajes drop constraint if exists mensajes_sesion_id_fkey;
alter table pendientes drop constraint if exists pendientes_conversacion_id_fkey;
alter table archivos drop constraint if exists archivos_conversacion_id_fkey;
alter table documentos drop constraint if exists documentos_conversacion_id_fkey;

-- 2026-10-20: cuarentena documental. Ejecuta este bloque completo en instalaciones existentes.
-- Es una migración aditiva: las filas anteriores también quedan cerradas hasta un análisis explícito;
-- no se publica, firma ni revisa manualmente ningún objeto por defecto.
alter table documentos add column if not exists seguridad_estado text not null default 'cuarentena';
alter table documentos add column if not exists seguridad_motivo text not null default '';
alter table documentos add column if not exists seguridad_revisado_en timestamptz;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'documentos'::regclass and conname = 'documentos_seguridad_estado_check'
  ) then
    alter table documentos add constraint documentos_seguridad_estado_check
      check (seguridad_estado in ('cuarentena', 'limpio', 'bloqueado', 'error'));
  end if;
end $$;
create index if not exists documentos_seguridad_estado on documentos (notaria_id, seguridad_estado) where borrado_en is null;

-- 2026-10-23: chat de ventas de SOFIA PreFirma en el sitio comercial. Ejecuta este bloque antes de desplegar /api/ventas.
-- Las conversaciones de ventas viven en su propio tenant («sofia-ventas»: NOTARIA_ID del proyecto comercial) y nunca se
-- mezclan con las de una notaría. Los interesados se guardan aparte para que sobrevivan a la purga de los chats; por eso
-- conversacion_id no lleva clave foránea.
insert into notarias (id, nombre) values ('sofia-ventas', 'SOFIA PreFirma · ventas') on conflict (id) do nothing;
create table if not exists prospectos (
  id bigint generated always as identity primary key,
  notaria_id text not null references notarias(id),
  conversacion_id uuid,
  nombre text not null,
  notaria text not null default '',
  ciudad text not null default '',
  cargo text not null default '',
  telefono text not null default '',
  correo text not null default '',
  plan text not null default '',
  motivo text not null check (motivo in ('demostracion', 'cotizacion', 'contratar', 'asesor', 'soporte')),
  detalle text not null default '',
  creado timestamptz not null default now()
);
create index if not exists prospectos_notaria_creado on prospectos (notaria_id, creado desc);
alter table prospectos enable row level security;
revoke all on prospectos from anon, authenticated;

-- 2026-10-23b: pago en línea de los planes de SOFIA PreFirma (PagoMedios). Ejecuta este bloque antes de habilitar
-- PAGOS_PROVEEDOR=pagomedios en el proyecto comercial. El monto lo fija el servidor según el plan; la tarjeta nunca pasa
-- por el sitio y el estado solo cambia después de consultar a PagoMedios.
create table if not exists pagos_planes (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  plan text not null,
  periodo text not null check (periodo in ('mensual', 'anual')),
  base_centavos integer not null check (base_centavos > 0),
  iva_centavos integer not null check (iva_centavos >= 0),
  total_centavos integer not null check (total_centavos > 0),
  moneda text not null default 'USD',
  proveedor text not null,
  orden_proveedor text unique,
  estado text not null default 'creado' check (estado in ('creado', 'pendiente', 'pagado', 'fallido', 'reembolsado')),
  nombre text not null,
  notaria text not null default '',
  telefono text not null default '',
  correo text not null default '',
  documento text not null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  pagado_en timestamptz
);
create index if not exists pagos_planes_notaria_creado on pagos_planes (notaria_id, creado desc);
alter table pagos_planes enable row level security;
revoke all on pagos_planes from anon, authenticated;

-- 2026-10-23c: turnero (fila virtual en la notaría). Ejecuta este bloque antes de encender la función «Turnos en la
-- notaría». El número es correlativo por notaría y día; el código secreto le permite al cliente ver su turno sin cuenta.
create table if not exists turnos (
  id uuid primary key default gen_random_uuid(),
  notaria_id text not null references notarias(id),
  fecha date not null,
  numero integer not null check (numero > 0),
  nombre text not null check (length(nombre) between 2 and 60),
  celular text check (celular ~ '^[0-9]{11,13}$'),
  motivo text not null default '',
  canal text not null default 'web' check (canal in ('web', 'whatsapp', 'recepcion')),
  codigo text not null unique check (codigo ~ '^[0-9a-f]{24}$'),
  estado text not null default 'esperando' check (estado in ('esperando', 'llamado', 'atendido', 'ausente', 'cancelado')),
  ventanilla text not null default '',
  creado timestamptz not null default now(),
  llamado_en timestamptz,
  atendido_en timestamptz,
  unique (notaria_id, fecha, numero)
);
create index if not exists turnos_notaria_fecha on turnos (notaria_id, fecha, estado);
alter table turnos enable row level security;
revoke all on turnos from anon, authenticated;

-- 2026-10-23d: canales nuevos en el historial de consentimientos (chat y formularios de SOFIA PreFirma, turnero). Ejecútalo
-- antes de abrir el chat de ventas: sin él, esas aceptaciones no quedan registradas como evidencia (LOPDP, art. 8).
alter table consentimientos drop constraint if exists consentimientos_canal_check;
alter table consentimientos add constraint consentimientos_canal_check check (canal in ('formulario', 'chat-web', 'whatsapp', 'documentos', 'portal',
  'chat-ventas', 'formulario-ventas', 'pago-plan', 'turnero'));
