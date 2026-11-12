package com.bidflow.adapters.search;

import com.bidflow.application.search.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

public final class OpenSearchProductSearchReader implements ProductSearchReader {
    private final HttpClient client; private final URI endpoint; private final ObjectMapper mapper;
    public OpenSearchProductSearchReader(HttpClient client, URI endpoint, ObjectMapper mapper) { this.client = client; this.endpoint = endpoint; this.mapper = mapper; }
    @Override public SearchListingsPage search(SearchListingsQuery query) {
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint.resolve("/bidflow-products-read/_search"))
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body(query)))).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new SearchUnavailableException("OpenSearch status " + response.statusCode());
            return page(query, mapper.readTree(response.body()));
        } catch (SearchUnavailableException | InvalidSearchQueryException exception) { throw exception;
        } catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new SearchUnavailableException(exception);
        } catch (Exception exception) { throw new SearchUnavailableException(exception); }
    }
    private Map<String, Object> body(SearchListingsQuery query) {
        List<Map<String, Object>> filters = new ArrayList<>();
        filters.add(Map.of("term", Map.of("searchable", true)));
        query.categoryId().ifPresent(value -> filters.add(Map.of("term", Map.of("categoryId", value))));
        query.status().ifPresent(value -> filters.add(Map.of("term", Map.of("status", value))));
        range(query.minPrice(), query.maxPrice()).ifPresent(value -> filters.add(Map.of("range", Map.of("currentPrice", value))));
        query.endsBefore().ifPresent(value -> filters.add(Map.of("range", Map.of("endsAt", Map.of("lte", value.toString())))));
        Map<String, Object> bool = new LinkedHashMap<>(); bool.put("filter", filters);
        if (!query.keyword().trim().isEmpty()) bool.put("must", List.of(Map.of("match", Map.of("title", query.keyword().trim()))));
        Map<String, Object> body = new LinkedHashMap<>(); body.put("query", Map.of("bool", bool)); body.put("size", query.size()); body.put("sort", sort(query.sort()));
        body.put("_source", List.of("productId", "title", "categoryId", "thumbnailObjectKey", "currentPrice", "status", "endsAt"));
        query.cursor().ifPresent(cursor -> body.put("search_after", decodeCursor(query, cursor)));
        return body;
    }
    private SearchListingsPage page(SearchListingsQuery query, JsonNode root) {
        List<SearchListingItem> items = new ArrayList<>(); JsonNode hits = root.path("hits").path("hits"); List<String> lastSort = List.of();
        for (JsonNode hit : hits) { JsonNode source = hit.path("_source"); items.add(new SearchListingItem(UUID.fromString(source.path("productId").asText()), source.path("title").asText(), source.path("categoryId").asText(), source.path("thumbnailObjectKey").isNull() ? null : source.path("thumbnailObjectKey").asText(), source.path("currentPrice").asLong(), source.path("status").asText(), Instant.parse(source.path("endsAt").asText()))); lastSort = values(hit.path("sort")); }
        return new SearchListingsPage(items, items.size() == query.size() ? Optional.of(encodeCursor(query, lastSort)) : Optional.empty());
    }
    private static Optional<Map<String, Object>> range(Optional<Long> min, Optional<Long> max) { if (min.isEmpty() && max.isEmpty()) return Optional.empty(); Map<String, Object> value = new LinkedHashMap<>(); min.ifPresent(v -> value.put("gte", v)); max.ifPresent(v -> value.put("lte", v)); return Optional.of(value); }
    private static List<Map<String, Object>> sort(SearchSort sort) { String field = switch (sort) { case RELEVANCE -> "_score"; case ENDING_SOON -> "endsAt"; case PRICE_ASC, PRICE_DESC -> "currentPrice"; case NEWEST -> "startsAt"; }; String order = switch (sort) { case PRICE_DESC, NEWEST, RELEVANCE -> "desc"; default -> "asc"; }; return List.of(Map.of(field, Map.of("order", order)), Map.of("productId", Map.of("order", "asc"))); }
    private static List<String> values(JsonNode node) { List<String> values = new ArrayList<>(); node.forEach(value -> values.add(value.asText())); return values; }
    private static String encodeCursor(SearchListingsQuery query, List<String> values) { return Base64.getUrlEncoder().withoutPadding().encodeToString((fingerprint(query) + "\n" + String.join("\n", values)).getBytes(StandardCharsets.UTF_8)); }
    private static List<Object> decodeCursor(SearchListingsQuery query, String cursor) { try { String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\n", -1); if (parts.length != 3 || !parts[0].equals(fingerprint(query))) throw new IllegalArgumentException(); Object first = switch (query.sort()) { case PRICE_ASC, PRICE_DESC -> Long.parseLong(parts[1]); case RELEVANCE -> Double.parseDouble(parts[1]); case ENDING_SOON, NEWEST -> parts[1]; }; return List.of(first, parts[2]); } catch (Exception exception) { throw new InvalidSearchQueryException("invalid cursor"); } }
    private static String fingerprint(SearchListingsQuery q) { try { String raw = q.keyword().trim() + "|" + q.categoryId().orElse("") + "|" + q.status().orElse("") + "|" + q.minPrice().map(Object::toString).orElse("") + "|" + q.maxPrice().map(Object::toString).orElse("") + "|" + q.endsBefore().map(Object::toString).orElse("") + "|" + q.sort(); return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8))); } catch (Exception exception) { throw new IllegalStateException(exception); } }
}
