// Load Bootstrap and JQuery (Fix Electron Bug)
window.$ = window.jQuery = require("jquery"); // not sure if you need this at all
window.Bootstrap = require("bootstrap");

const url = require("url");
const shell = require("electron").shell;

// Open all URLs in your own web-browser
$(document).on("click", 'a[href^="http"]', function (event) {
  event.preventDefault();
  shell.openExternal(this.href);
});

// GLOBALS
const QUEUE_RECOMMENDED = "potluck";
const QUEUE_AVAILABLE_FOR_ALL = "last_chance";
const QUEUE_ADDITIONAL_ITEMS = "encore";
const ITEMS_PER_PAGE = 60;

// INITIALIZATION
window.addEventListener("load", async (event) => {});

// Fix scroll bug
var scrollTimer;
$(".scroller").on("scroll", function (e) {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    this.scrollTop = Math.max(
      1,
      Math.min(this.scrollTop, this.scrollHeight - this.clientHeight - 1)
    );
  }, 300);
});

function applyFilter() {
  const search = $("#filter-search").val().toLowerCase();

  // Get All Filter Values
  const minTaxValue = parseInt($("#tax-value-min").val()) || 0;
  const maxTaxValue = parseInt($("#tax-value-max").val()) || 2147483647;
  const minRating = parseInt($("#min-rating").val()) || 0;

  // Perform Filter
  filteredItems = items.filter((item) => {
    return item.productName.toLowerCase().includes(search); //&&
    //item.taxValue >= minTaxValue &&
    //item.taxValue <= maxTaxValue &&
    //item.avgRating >= minRating
  });

  console.log(filteredItems);

  filteredItems = sort(filteredItems);

  // Apply Filter if Changes
  updateItemsContainer(filteredItems);
}

function sort(items) {
  let sorted = items;
  const method = $("#order-by").val();
  const direction = $("#order-direction").val();
  switch (method) {
    case "default":
      break;
    case "name":
      sorted = Array.from(items).sort((a, b) => {
        return a.productName.localeCompare(b.productName, "en", { sensitivity: "base" });
      });
      break;
    case "tax-value":
      break;
    case "rating":
      break;
    case "retail-value":
      break;
    case "percent-diff":
      break;
  }
  if (direction == "ascending") {
    sorted.reverse();
  }
  return sorted;
}

function clearFilter() {
  console.log("Clearing Filter!");
  $("#filter-search").val("");
  $("#tax-value-min").val("");
  $("#tax-value-max").val("");
  $("#min-rating").val("Any");
  $("#order-by").val("date-added");
  $("#order-direction").val("descending");
  filteredItems = items;
  updateItemsContainer(items);
}

function generateItemUrl(pn, cn, position) {
  return url.format({
    host: "https://www.amazon.com/vine/vine-items",
    query: { queue: "last_chance", size: 1, pn: pn, cn: cn, page: position },
  });
}

function clearItemContainer() {
  const container = $("#items-container > ul");
  container.empty();
}

function addItemToContainer(item) {
  const container = $("#items-container > ul");
  // Create List Item
  const page = Math.ceil(item.position / ITEMS_PER_PAGE);
  const category = categories.filter((category) => category.name === item.category)[0];
  const subcategory = category.subcategories.filter(
    (subcategory) => subcategory.name === item.subcategory
  )[0];
  const itemPageUrl = generateItemUrl(category.nodeId, subcategory.nodeId, item.position);
  container.append(
    `
    <li class="media my-2 border rounded border-secondary">
      <img class="mr-3 img-thumbnail" src="${item.thumbnail}" width="125px">
        <div class="media-body">
        <div class="display-6 mt-2 mb-1">${item.productName}</div>
        <div class="mt-auto">
          <div class="badge badge-primary">${item.category}</div> &gt; 
          <div class="badge badge-secondary">${item.subcategory}</div> &gt; 
          <div class="badge badge-info">Page ${page}</div> &gt; 
          <div class="badge badge-info">Position ${item.position}</div>
        </div>
        <a href="${itemPageUrl}" target="_blank">View In Amazon</a>
      </div>
    </li>`
  );
}

function updateSearchInfo(itemsFound) {
  // Change Search Result Number
  $("#search-info > div > div").text(`Search Results: ${itemsFound} Items Found`);
}

/**
 * Updates the list of items in the container.
 * @param {List[string]} itemList
 */
function updateItemsContainer(itemList) {
  // Clear Container
  clearItemContainer();
  // Load Container
  updateSearchInfo(itemList.length);
  itemList.forEach((item) => {
    addItemToContainer(item);
  });
}
