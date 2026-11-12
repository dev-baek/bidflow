package com.bidflow.application.search;

public interface ProductSearchReader {
    SearchListingsPage search(SearchListingsQuery query);
}
