package com.bidflow.runtime;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.bidflow.application.auction.PublicAuctionImageReader;
import com.bidflow.application.auction.PublicAuctionImages;
import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.StoredObject;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PublicAuctionImagesControllerTest {
    private final UUID auctionId = UUID.randomUUID();
    private final UUID imageId = UUID.randomUUID();
    private final String path = "/api/v1/auctions/" + auctionId + "/images";
    private final String key = "products/seller/internal";
    private final URI signed = URI.create("https://storage.example.test/signed");
    private final PublicAuctionImageReader reader = mock(PublicAuctionImageReader.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);

    private MockMvc mvc() {
        return MockMvcBuilders.standaloneSetup(new PublicAuctionImagesController(new PublicAuctionImages(reader, storage))).build();
    }

    @Test
    void disclosesOnlyOrderedIdsAndRedirectsToBrowserReadUrl() throws Exception {
        when(reader.findImageIds(auctionId)).thenReturn(Optional.of(List.of(imageId)));
        when(reader.findObjectKey(auctionId, imageId)).thenReturn(Optional.of(key));
        when(reader.findThumbnailObjectKey(auctionId)).thenReturn(Optional.of(key));
        when(storage.headObject(key)).thenReturn(Optional.of(new StoredObject(key, "image/png", 42)));
        when(storage.presignRead(key)).thenReturn(signed);
        var mvc = mvc();

        mvc.perform(get(path)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().json("{\"imageIds\":[\"" + imageId + "\"]}", JsonCompareMode.STRICT));
        for (String id : List.of(imageId.toString(), "thumbnail")) {
            mvc.perform(get(path + "/" + id)).andExpect(status().isTemporaryRedirect())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().string("Location", signed.toString()));
        }
    }

    @Test
    void neverSignsUnregisteredMissingOrDisallowedObjects() throws Exception {
        var mvc = mvc();
        mvc.perform(get(path)).andExpect(status().isNotFound());
        mvc.perform(get(path + "/" + imageId).param("objectKey", key)).andExpect(status().isNotFound())
                .andExpect(header().doesNotExist("Location"));
        verifyNoInteractions(storage);

        when(reader.findObjectKey(auctionId, imageId)).thenReturn(Optional.of(key));
        when(storage.headObject(key)).thenReturn(Optional.empty()).thenReturn(Optional.of(new StoredObject(key, "text/html", 42)));
        for (int i = 0; i < 2; i++) {
            mvc.perform(get(path + "/" + imageId)).andExpect(status().isNotFound())
                    .andExpect(header().doesNotExist("Location"));
        }
        verify(storage, never()).presignRead(anyString());
    }
}
