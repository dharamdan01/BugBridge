\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

-- Source-verified columns only; no keys/configuration/message bodies selected.
-- psql quoted variables are SQL literals, never interpolated SQL fragments.
SELECT json_build_object('section', 'agent', 'data', json_build_object(
  'tenant_id', a.tenant_id, 'agent_id', a.id,
  'agent_participant_id', c.matrix_user_id, 'client_type', c.type,
  'room_id', r.id, 'bridge_id', b.id, 'bridge_type', b.type,
  'mattermost_channel_id', r.external_channel_id))
FROM agents a
JOIN clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
JOIN rooms r ON r.id = :'room_id' AND r.tenant_id = a.tenant_id
JOIN collaboration_bridges b ON b.id = r.bridge_id AND b.tenant_id = r.tenant_id
WHERE a.id = :'agent_id' AND c.type = 'agent' AND b.type = 'mattermost'
LIMIT 2;

SELECT json_build_object('section', 'human', 'data', json_build_object(
  'tenant_id', eu.tenant_id, 'bridge_id', eu.bridge_id,
  'external_user_id', eu.external_user_id,
  'human_participant_id', c.matrix_user_id, 'client_type', c.type))
FROM agents a
JOIN rooms r ON r.id = :'room_id' AND r.tenant_id = a.tenant_id
JOIN collaboration_bridges b ON b.id = r.bridge_id AND b.tenant_id = r.tenant_id
JOIN external_users eu ON eu.bridge_id = b.id AND eu.tenant_id = b.tenant_id
JOIN clients c ON c.id = eu.client_id AND c.tenant_id = eu.tenant_id
WHERE a.id = :'agent_id' AND eu.external_user_id = :'mattermost_user_id'
  AND b.type = 'mattermost' AND c.type = 'user'
LIMIT 2;

-- An open row is a candidate connection context, not proof of live ownership.
SELECT json_build_object('section', 'connection', 'data', json_build_object(
  'connection_id', ac.id, 'agent_id', ac.agent_id, 'room_id', cr.room_id,
  'scope', ac.scope, 'transport', ac.transport))
FROM agent_connections ac
JOIN agent_connection_rooms cr ON cr.connection_id = ac.id
  AND cr.tenant_id = ac.tenant_id AND cr.agent_id = ac.agent_id
WHERE ac.agent_id = :'agent_id' AND cr.room_id = :'room_id' AND ac.closed_at IS NULL
LIMIT 5;

-- Corroborate previously delivered human sender metadata; never select body.
SELECT json_build_object('section', 'sender_event', 'data', json_build_object(
  'message_id', e.payload ->> 'message_id', 'sender', e.payload ->> 'sender',
  'sender_kind', e.payload ->> 'sender_kind'))
FROM agent_events e
JOIN rooms r ON r.id = e.room_id AND r.tenant_id = e.tenant_id
JOIN external_users eu ON eu.bridge_id = r.bridge_id AND eu.tenant_id = r.tenant_id
JOIN clients c ON c.id = eu.client_id AND c.tenant_id = eu.tenant_id
WHERE e.agent_id = :'agent_id' AND e.room_id = :'room_id'
  AND eu.external_user_id = :'mattermost_user_id' AND c.type = 'user'
  AND e.type = 'message' AND e.payload ->> 'sender' = c.matrix_user_id
ORDER BY e.seq DESC
LIMIT 5;
ROLLBACK;
