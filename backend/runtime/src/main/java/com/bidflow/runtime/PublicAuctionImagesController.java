package com.bidflow.runtime;

import com.bidflow.application.auction.PublicAuctionImages;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auctions/{auctionId}/images")
class PublicAuctionImagesController {
    private final PublicAuctionImages images;

    PublicAuctionImagesController(PublicAuctionImages images) {
        this.images = images;
    }

    @GetMapping
    ResponseEntity<ImageList> list(@PathVariable UUID auctionId) {
        return images.imageIds(auctionId)
                .map(ids -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ImageList(ids)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).cacheControl(CacheControl.noStore()).build());
    }

    @GetMapping("/{imageId}")
    ResponseEntity<Void> read(@PathVariable UUID auctionId, @PathVariable UUID imageId) {
        return redirect(images.read(auctionId, imageId));
    }

    @GetMapping("/thumbnail")
    ResponseEntity<Void> thumbnail(@PathVariable UUID auctionId) {
        return redirect(images.thumbnail(auctionId));
    }

    private static ResponseEntity<Void> redirect(Optional<URI> location) {
        return location.map(uri -> ResponseEntity.status(HttpStatus.TEMPORARY_REDIRECT).location(uri)
                        .header("Referrer-Policy", "no-referrer").cacheControl(CacheControl.noStore()).<Void>build())
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).cacheControl(CacheControl.noStore()).build());
    }

    record ImageList(List<UUID> imageIds) {}
}
