local requestId = ARGV[1]
local bidderId = ARGV[2]
local maximum = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local retentionMillis = 24 * 60 * 60 * 1000
local extensionThresholdMillis = 5 * 60 * 1000

local replay = redis.call('HGET', KEYS[3], requestId)
if replay then
  local result = cjson.decode(replay)
  return {result.code, tostring(result.currentPrice), result.winnerId, tostring(result.winnerMaximum), tostring(result.endsAt), tostring(result.version)}
end

if redis.call('EXISTS', KEYS[1]) == 0 then
  return {'NOT_ACTIVE', '0', '', '0', '0', '0'}
end

local status = redis.call('HGET', KEYS[1], 'status')
local currentPrice = tonumber(redis.call('HGET', KEYS[1], 'currentPrice'))
local winnerId = redis.call('HGET', KEYS[1], 'winnerId')
local winnerMaximum = tonumber(redis.call('HGET', KEYS[1], 'winnerMax'))
local startsAt = tonumber(redis.call('HGET', KEYS[1], 'startsAt'))
local endsAt = tonumber(redis.call('HGET', KEYS[1], 'endsAt'))
local version = tonumber(redis.call('HGET', KEYS[1], 'version'))

local function saveResult(code)
  local result = {code = code, currentPrice = currentPrice, winnerId = winnerId, winnerMaximum = winnerMaximum, endsAt = endsAt, version = version}
  redis.call('HSET', KEYS[3], requestId, cjson.encode(result))
  local expiresAt = endsAt + retentionMillis
  redis.call('PEXPIREAT', KEYS[1], expiresAt)
  redis.call('PEXPIREAT', KEYS[2], expiresAt)
  redis.call('PEXPIREAT', KEYS[3], expiresAt)
  return {code, tostring(currentPrice), winnerId, tostring(winnerMaximum), tostring(endsAt), tostring(version)}
end

if now < startsAt then return saveResult('AUCTION_NOT_STARTED') end
if now >= endsAt or (status ~= 'SCHEDULED' and status ~= 'ACTIVE') then return saveResult('AUCTION_ENDED') end

local function incrementFor(price)
  if price < 100000 then return 1000 end
  if price < 500000 then return 5000 end
  if price < 1000000 then return 10000 end
  return 50000
end

if maximum < currentPrice + incrementFor(currentPrice) then return saveResult('BID_TOO_LOW') end

if winnerId == bidderId and maximum <= winnerMaximum then return saveResult('BID_TOO_LOW') end

redis.call('ZADD', KEYS[2], maximum, bidderId)

if winnerId == bidderId then
  winnerMaximum = maximum
elseif maximum > winnerMaximum then
  currentPrice = math.min(maximum, winnerMaximum + incrementFor(winnerMaximum))
  winnerId = bidderId
  winnerMaximum = maximum
else
  currentPrice = math.min(winnerMaximum, maximum + incrementFor(maximum))
end

version = version + 1
if endsAt - now < extensionThresholdMillis then endsAt = endsAt + extensionThresholdMillis end
redis.call('HSET', KEYS[1], 'status', 'ACTIVE', 'currentPrice', currentPrice, 'winnerId', winnerId, 'winnerMax', winnerMaximum, 'endsAt', endsAt, 'version', version)

return saveResult('ACCEPTED')
